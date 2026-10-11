import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHOICE_LETTERS = ["A", "B", "C", "D", "E"];

function normalizeNewtonQuestions(rawQuestions: any[]): any[] {
  if (!Array.isArray(rawQuestions)) return [];

  return rawQuestions.map((q: any) => {
    if (q && q.questionHash && Array.isArray(q.options) && ("correctChoice" in q || "correctChoiceLetter" in q)) {
      return q;
    }

    const mcq = q.multiple_choice_question || q;
    const questionType = mcq.question_type || q.question_type || 1;

    const options: any[] = [];
    CHOICE_LETTERS.forEach((letter) => {
      const textKey = `choice_${letter}_text`;
      const imgKey = `choice_${letter}_image`;
      const text = mcq[textKey];
      const image = mcq[imgKey] || null;

      if (text !== undefined && text !== null && text !== "") {
        options.push({
          id: letter,
          text: String(text).trim(),
          image: image,
        });
      }
    });

    const correctChoice = typeof mcq.correct_choice === "number" ? mcq.correct_choice : null;
    const correctLetter = correctChoice && correctChoice >= 1 && correctChoice <= 5
      ? CHOICE_LETTERS[correctChoice - 1]
      : null;

    return {
      questionHash: q.hash || mcq.hash || "",
      mcqHash: mcq.hash || undefined,
      questionText: mcq.question_text || "",
      questionType: questionType,
      marks: mcq.marks || 0,
      options: options,
      correctChoice: correctChoice,
      correctChoiceLetter: correctLetter,
      correctExplanation: mcq.correct_choice_explanation || null,
      correctPuzzleAnswer: mcq.correct_puzzle_answer || null,
    };
  });
}

function cleanToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let str = String(raw).trim();
  if (str.startsWith("Bearer ")) {
    str = str.slice(7).trim();
  }
  return str || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase environment variables on server" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Server-side client using Service Role to write directly to DB (bypassing RLS client restrictions)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { action, authToken: rawToken, courseHash, assessmentHash, uid } = body;
    const token = cleanToken(rawToken);

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing authToken" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION 1: ARCHIVE A SINGLE SUBMITTED QUIZ
    // =========================================================================
    if (action === "ARCHIVE_ONE") {
      if (!courseHash || !assessmentHash) {
        return new Response(
          JSON.stringify({ error: "Missing courseHash or assessmentHash" }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // 1. Check if answers are already verified in DB
      const { data: existing } = await supabase
        .from("quizzes")
        .select("assessment_hash, has_answers_revealed")
        .eq("assessment_hash", assessmentHash)
        .maybeSingle();

      if (existing && existing.has_answers_revealed) {
        return new Response(
          JSON.stringify({ status: "CACHE_HIT", assessmentHash }),
          { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // 2. Fetch directly from Newton LMS from AWS Mumbai
      const lmsUrl = `https://my.newtonschool.co/api/v1/course/h/${courseHash}/assessment/h/${assessmentHash}/questions/`;
      const lmsResp = await fetch(lmsUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
        }
      });

      if (!lmsResp.ok) {
        const errText = await lmsResp.text();
        return new Response(
          JSON.stringify({ error: `Newton LMS returned HTTP ${lmsResp.status}`, details: errText }),
          { status: lmsResp.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const rawQuestions = await lmsResp.json();
      const questionsList = Array.isArray(rawQuestions) ? rawQuestions : (rawQuestions.questions || []);
      const normalized = normalizeNewtonQuestions(questionsList);
      const hasSolutions = normalized.some((q) => q.correctChoice !== null || q.correctExplanation !== null);

      // 3. Server writes directly to quizzes table
      const { error: dbError } = await supabase
        .from("quizzes")
        .upsert({
          assessment_hash: assessmentHash,
          course_hash: courseHash,
          title: "Quiz Assessment",
          total_questions: normalized.length,
          has_answers_revealed: hasSolutions,
          questions: normalized,
          archived_by_uid: uid || null,
          updated_at: new Date().toISOString()
        });

      if (dbError) {
        return new Response(
          JSON.stringify({ error: dbError.message }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ status: "SUCCESS", assessmentHash, hasAnswersRevealed: hasSolutions }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION 2: FULL HISTORICAL SYNC OF ALL SUBMITTED QUIZZES
    // =========================================================================
    if (action === "SYNC_ALL") {
      let activeCourse = courseHash;

      // If active course not provided, resolve active semester directly from LMS
      if (!activeCourse) {
        const appliedUrl = "https://my.newtonschool.co/api/v2/course/all/applied/?pagination=false&completed=false";
        const appliedResp = await fetch(appliedUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`
          }
        });
        if (appliedResp.ok) {
          const courses = await appliedResp.json();
          if (Array.isArray(courses) && courses[0]) {
            const adminCourses = courses[0]?.children_courses?.admin_unit_courses || [];
            const active = adminCourses.find((c: any) => c.is_active_admin_unit_course) || adminCourses[0] || courses[0];
            activeCourse = active.hash || courses[0].hash;
          }
        }
      }

      if (!activeCourse) {
        return new Response(
          JSON.stringify({ error: "Could not resolve active semester course hash" }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // 1. Fetch completed assessments list from LMS
      const assessmentsUrl = `https://my.newtonschool.co/api/v2/course/h/${activeCourse}/assessment/all/?attempt_statuses=3&limit=100&offset=0`;
      const assessmentsResp = await fetch(assessmentsUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });

      if (!assessmentsResp.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch assessments: HTTP ${assessmentsResp.status}` }),
          { status: assessmentsResp.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const data = await assessmentsResp.json();
      const assessments = Array.isArray(data.results) ? data.results : [];

      // 2. Check which assessments are already verified in Supabase
      const hashes = assessments.map((a: any) => a.hash).filter(Boolean);
      let existingSet = new Set<string>();

      if (hashes.length > 0) {
        const { data: existingRows } = await supabase
          .from("quizzes")
          .select("assessment_hash, has_answers_revealed")
          .in("assessment_hash", hashes);

        if (Array.isArray(existingRows)) {
          existingRows.forEach((r) => {
            if (r.has_answers_revealed) {
              existingSet.add(r.assessment_hash);
            }
          });
        }
      }

      const missing = assessments.filter((a: any) => a.hash && !existingSet.has(a.hash));
      let newlyArchived = 0;
      let alreadyExisted = existingSet.size;

      // 3. Fetch missing assessments from LMS and save directly
      for (const item of missing) {
        const itemHash = item.hash;
        const itemCourse = item.course?.hash || activeCourse;
        const title = item.title || "Quiz Assessment";

        try {
          const qUrl = `https://my.newtonschool.co/api/v1/course/h/${itemCourse}/assessment/h/${itemHash}/questions/`;
          const qResp = await fetch(qUrl, {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "Authorization": `Bearer ${token}`
            }
          });

          if (qResp.ok) {
            const rawQuestions = await qResp.json();
            const questionsList = Array.isArray(rawQuestions) ? rawQuestions : (rawQuestions.questions || []);
            const normalized = normalizeNewtonQuestions(questionsList);
            const hasSolutions = normalized.some((q) => q.correctChoice !== null || q.correctExplanation !== null);

            await supabase
              .from("quizzes")
              .upsert({
                assessment_hash: itemHash,
                course_hash: itemCourse,
                title: title,
                total_questions: normalized.length,
                has_answers_revealed: hasSolutions,
                questions: normalized,
                archived_by_uid: uid || null,
                updated_at: new Date().toISOString()
              });

            newlyArchived++;
          }
        } catch (e) {
          console.warn(`[sync-quizzes] Error syncing assessment ${itemHash}:`, e);
        }
      }

      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          summary: {
            totalFound: assessments.length,
            alreadyExisted,
            newlyArchived
          }
        }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
