/**
 * Newton Enhancer - Quiz Solution Client & Interceptor
 * Powered by Supabase (AWS Mumbai ap-south-1)
 *
 * Handles:
 * 1. Direct browser LMS extraction (bypasses any server WAF IP restrictions)
 * 2. Question normalization and option parsing
 * 3. Fast caching checks via Supabase PostgREST API (<5ms ping to Mumbai)
 * 4. Ingestion of extracted quizzes to Supabase PostgreSQL with RLS protection
 * 5. LMS auth-token validation and live diagnostics
 */

// Supabase Configuration (AWS Mumbai - ap-south-1)
// Replace with your Supabase project credentials from Project Settings -> API
export const SUPABASE_CONFIG = {
  url: 'https://wwxqskccvcpimcgctskm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eHFza2NjdmNwaW1jZ2N0c2ttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjM2MjgsImV4cCI6MjEwNzI5OTYyOH0.uEXGkzcIXbqyU5lRnFVyAF0c04YI0SoED6p98EYrbcc'
};

const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Extracts and sanitizes Bearer auth token from any format:
 * - Plain JWT / Bearer string
 * - JSON stringified object: {"token":"..."} or {"access_token":"..."}
 * - Double-stringified JSON
 */
export function extractCleanAuthToken(raw) {
  if (!raw) return null;
  let parsed = raw;
  let attempts = 0;
  while (typeof parsed === 'string' && attempts < 3) {
    try {
      const temp = JSON.parse(parsed);
      if (typeof temp === 'object' || typeof temp === 'string') {
        parsed = temp;
      } else {
        break;
      }
    } catch (e) {
      break;
    }
    attempts++;
  }

  let tokenStr = null;
  if (typeof parsed === 'string') {
    const tokenMatch = parsed.match(/['"]?(?:access_)?token['"]?\s*:\s*['"]?([^'"}\s]+)['"]?/i);
    if (tokenMatch) {
      tokenStr = tokenMatch[1];
    } else {
      tokenStr = parsed;
    }
  } else if (typeof parsed === 'object' && parsed !== null) {
    tokenStr = parsed.token || parsed.access_token || parsed.authToken || parsed.auth_token || null;
  }

  if (typeof tokenStr === 'string') {
    return tokenStr.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}

/**
 * Normalizes raw Newton LMS questions array into clean, structured questions
 */
export function normalizeNewtonQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return [];

  return rawQuestions.map((q) => {
    if (q && q.questionText !== undefined && Array.isArray(q.options)) {
      return q;
    }

    const mcq = q.multiple_choice_question || q || {};
    const questionType = mcq.question_type || q.question_type || 1;

    const options = [];
    CHOICE_LETTERS.forEach((letter) => {
      const textKey = `choice_${letter}_text`;
      const imgKey = `choice_${letter}_image`;
      const text = mcq[textKey];
      const image = mcq[imgKey] || null;

      if (text !== undefined && text !== null && text !== '') {
        options.push({
          id: letter,
          text: String(text).trim(),
          image: image,
        });
      }
    });

    const correctChoice = typeof mcq.correct_choice === 'number' ? mcq.correct_choice : null;
    const correctLetter = correctChoice && correctChoice >= 1 && correctChoice <= 5
      ? CHOICE_LETTERS[correctChoice - 1]
      : null;

    return {
      questionHash: q.hash || '',
      mcqHash: mcq.hash || undefined,
      questionText: mcq.question_text || '',
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

/**
 * Step 1: Check if solutions already exist in Supabase via PostgREST API
 *
 * @param {string} assessmentHash
 * @returns {Promise<{exists: boolean, data?: object}>}
 */
export async function checkSolutionsInSupabase(assessmentHash) {
  if (!assessmentHash || !SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
    return { exists: false, hasAnswers: false };
  }

  try {
    const url = `${SUPABASE_CONFIG.url}/rest/v1/quizzes?assessment_hash=eq.${encodeURIComponent(assessmentHash)}&select=*`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      console.warn(`[QuizClient] Supabase REST returned HTTP ${resp.status}`);
      return { exists: false, hasAnswers: false };
    }

    const list = await resp.json();
    if (Array.isArray(list) && list.length > 0) {
      const doc = list[0];
      const hasQuestions = Array.isArray(doc.questions) && doc.questions.length > 0;
      const hasAnswers = !!doc.has_answers_revealed;
      if (hasQuestions) {
        return {
          exists: true,
          hasAnswers: hasAnswers,
          data: {
            assessmentHash: doc.assessment_hash,
            courseHash: doc.course_hash,
            title: doc.title,
            totalQuestions: doc.total_questions,
            hasAnswersRevealed: doc.has_answers_revealed,
            questions: doc.questions,
            createdAt: doc.created_at,
            updatedAt: doc.updated_at
          }
        };
      }
    }

    return { exists: false, hasAnswers: false };
  } catch (err) {
    console.warn('[QuizClient] Could not check Supabase cache:', err);
    return { exists: false, hasAnswers: false };
  }
}

/**
 * Batch checks which assessments already exist in Supabase and have answers revealed
 *
 * @param {string[]} assessmentHashes
 * @returns {Promise<Map<string, {exists: boolean, hasAnswersRevealed: boolean}>>}
 */
export async function batchCheckExistingAssessmentsInSupabase(assessmentHashes) {
  const result = new Map();
  if (!Array.isArray(assessmentHashes) || assessmentHashes.length === 0 || !SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
    return result;
  }

  const chunkSize = 40;
  for (let i = 0; i < assessmentHashes.length; i += chunkSize) {
    const chunk = assessmentHashes.slice(i, i + chunkSize);
    const filter = `in.("${chunk.map(encodeURIComponent).join('","')}")`;
    const url = `${SUPABASE_CONFIG.url}/rest/v1/quizzes?assessment_hash=${filter}&select=assessment_hash,has_answers_revealed`;

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Accept': 'application/json'
        }
      });

      if (resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows)) {
          for (const row of rows) {
            result.set(row.assessment_hash, {
              exists: true,
              hasAnswersRevealed: !!row.has_answers_revealed
            });
          }
        }
      }
    } catch (err) {
      console.warn('[QuizClient] Error checking existing assessments batch:', err);
    }
  }

  return result;
}

// Backward compatibility alias
export const checkSolutionsInFirestore = checkSolutionsInSupabase;

/**
 * Live test of Newton LMS auth token from the browser
 * Hits applied courses API directly to verify validity
 */
export async function testLMSAuthToken(token) {
  const clean = extractCleanAuthToken(token);
  if (!clean) {
    return {
      valid: false,
      reason: 'MISSING_TOKEN',
      message: 'No auth-token found in browser. Please open my.newtonschool.co and log in.'
    };
  }

  try {
    const url = 'https://my.newtonschool.co/api/v2/course/all/applied/?pagination=false&completed=false';
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${clean}`
      }
    });

    if (res.status === 200) {
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : 0;
      let activeCourse = null;
      if (Array.isArray(data) && data[0]) {
        const adminCourses = data[0]?.children_courses?.admin_unit_courses || [];
        const active = adminCourses.find(c => c.is_active_admin_unit_course) || adminCourses[0] || data[0];
        activeCourse = {
          title: active.title || data[0].title || 'Enrolled Course',
          hash: active.hash || data[0].hash
        };
      }

      return {
        valid: true,
        statusCode: 200,
        tokenPreview: clean.slice(0, 10) + '...' + clean.slice(-6),
        enrolledCount: count,
        activeCourse,
        message: `Token is valid! Found ${count} enrolled course(s).`
      };
    }

    if (res.status === 401) {
      return {
        valid: false,
        statusCode: 401,
        reason: 'EXPIRED',
        tokenPreview: clean.slice(0, 10) + '...' + clean.slice(-6),
        message: 'Newton LMS returned HTTP 401 Unauthorized. Your login session has expired.'
      };
    }

    if (res.status === 403) {
      return {
        valid: false,
        statusCode: 403,
        reason: 'FORBIDDEN',
        tokenPreview: clean.slice(0, 10) + '...' + clean.slice(-6),
        message: 'Newton LMS returned HTTP 403 Forbidden.'
      };
    }

    return {
      valid: false,
      statusCode: res.status,
      reason: `HTTP_${res.status}`,
      message: `Newton LMS returned HTTP ${res.status}.`
    };
  } catch (err) {
    return {
      valid: false,
      reason: 'NETWORK_ERROR',
      message: `Failed to connect to Newton LMS: ${err.message}`
    };
  }
}

/**
 * Fetches completed assessments list from LMS (attempt_statuses=3)
 * Runs from browser extension with resident session cookies / IP
 */
export async function fetchCompletedAssessmentsFromLMS(token, courseHash) {
  const clean = extractCleanAuthToken(token);
  if (!clean || !courseHash) return [];

  let allResults = [];
  let nextUrl = `https://my.newtonschool.co/api/v2/course/h/${encodeURIComponent(courseHash)}/assessment/all/?attempt_statuses=3&limit=100&offset=0`;
  let pageCount = 0;
  const maxPages = 10; // safety ceiling (up to 1000 assessments)

  while (nextUrl && pageCount < maxPages) {
    try {
      const res = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${clean}`
        }
      });

      if (!res.ok) {
        console.warn(`[QuizClient] Failed to fetch completed assessments page: HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      if (Array.isArray(data.results)) {
        allResults = allResults.concat(data.results);
      } else if (Array.isArray(data)) {
        allResults = allResults.concat(data);
        break;
      }

      pageCount++;
      if (data.next) {
        nextUrl = data.next.startsWith('http') ? data.next : `https://my.newtonschool.co${data.next}`;
      } else {
        nextUrl = null;
      }
    } catch (err) {
      console.warn('[QuizClient] Error during completed assessments fetch:', err);
      break;
    }
  }

  return allResults;
}

/**
 * Fetches questions and answers for a specific assessment from LMS
 */
export async function fetchAssessmentQuestionsFromLMS(token, courseHash, assessmentHash) {
  const clean = extractCleanAuthToken(token);
  if (!clean || !courseHash || !assessmentHash) return [];

  const url = `https://my.newtonschool.co/api/v1/course/h/${courseHash}/assessment/h/${assessmentHash}/questions/`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${clean}`
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch questions for assessment ${assessmentHash}: HTTP ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : (data.questions || []);
}

/**
 * Saves a single quiz directly to Supabase via PostgREST
 */
export async function saveQuizSolutionToSupabase(courseHash, assessmentHash, quizPayload, uid = null) {
  if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
    console.warn('[QuizClient] Supabase credentials not set, skipping remote save.');
    return { status: 'CONFIG_PENDING', assessmentHash };
  }

  const url = `${SUPABASE_CONFIG.url}/rest/v1/quizzes`;
  const row = {
    assessment_hash: assessmentHash,
    course_hash: courseHash,
    title: quizPayload.title || null,
    total_questions: Array.isArray(quizPayload.questions) ? quizPayload.questions.length : 0,
    has_answers_revealed: quizPayload.hasAnswersRevealed ?? true,
    questions: quizPayload.questions || [],
    archived_by_uid: uid || null,
    updated_at: new Date().toISOString()
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_CONFIG.anonKey,
      'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    const errorText = await res.text();
    if ((res.status === 401 || res.status === 403 || res.status === 409) && (errorText.includes('row-level security policy') || errorText.includes('42501'))) {
      console.log(`[QuizClient] Quiz ${assessmentHash} is immutable in Supabase (answers already verified under RLS).`);
      return { status: 'LOCKED_BY_RLS', assessmentHash };
    }
    throw new Error(`Failed to save quiz to Supabase: HTTP ${res.status} - ${errorText}`);
  }

  return { status: 'SUCCESS', assessmentHash };
}

// Backward compatibility alias
export const saveQuizSolutionToCloud = saveQuizSolutionToSupabase;

/**
 * Ingests a batch of extracted quizzes into Supabase via PostgREST
 */
export async function batchSaveQuizzesToSupabase(quizzes, uid = null) {
  if (!Array.isArray(quizzes) || quizzes.length === 0) {
    return { status: 'SUCCESS', savedCount: 0 };
  }

  if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
    console.warn('[QuizClient] Supabase credentials not set, skipping batch save.');
    return { status: 'CONFIG_PENDING', savedCount: 0 };
  }

  const url = `${SUPABASE_CONFIG.url}/rest/v1/quizzes`;
  const now = new Date().toISOString();

  const rows = quizzes.map((q) => ({
    assessment_hash: q.assessmentHash,
    course_hash: q.courseHash,
    title: q.title || null,
    total_questions: q.totalQuestions || (Array.isArray(q.questions) ? q.questions.length : 0),
    has_answers_revealed: q.hasAnswersRevealed ?? true,
    questions: q.questions || [],
    archived_by_uid: uid || null,
    updated_at: now
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_CONFIG.anonKey,
      'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const errorText = await res.text();
    // If a batch contains a row that is immutable under RLS, fall back to saving individually
    if ((res.status === 401 || res.status === 403 || res.status === 409) && (errorText.includes('row-level security policy') || errorText.includes('42501'))) {
      console.log('[QuizClient] Batch save encountered locked quiz under RLS. Falling back to individual saves...');
      let savedCount = 0;
      for (const q of quizzes) {
        try {
          const singleRes = await saveQuizSolutionToSupabase(q.courseHash, q.assessmentHash, q, uid);
          if (singleRes.status === 'SUCCESS' || singleRes.status === 'LOCKED_BY_RLS') {
            savedCount++;
          }
        } catch (e) {
          console.warn(`[QuizClient] Failed individual save for ${q.assessmentHash}:`, e.message);
        }
      }
      return { status: 'SUCCESS', savedCount };
    }
    throw new Error(`Batch save to Supabase failed: HTTP ${res.status} - ${errorText}`);
  }

  return { status: 'SUCCESS', savedCount: rows.length };
}

// Backward compatibility alias
export const batchSaveQuizzesToCloud = batchSaveQuizzesToSupabase;

/**
 * Orchestrator: Full historical sync performed safely on client
 *
 * 1. Resolves active semester
 * 2. Fetches completed assessments list
 * 3. Checks Supabase for each assessment
 * 4. Extracts questions from LMS for unarchived assessments
 * 5. Batch-saves all new quizzes to Supabase
 */
export async function syncHistoricalQuizzes(token, uid = null, preferredCourseHash = null, onProgress = null) {
  const cleanToken = extractCleanAuthToken(token);
  if (!cleanToken) {
    return { status: 'PENDING_AUTH', error: 'No valid auth token found' };
  }

  // 1. Resolve active semester
  let courseHash = (preferredCourseHash && preferredCourseHash !== 'h') ? preferredCourseHash : null;

  if (!courseHash && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get(['nst_portal_course_hash']);
      if (stored.nst_portal_course_hash && stored.nst_portal_course_hash !== 'h') {
        courseHash = stored.nst_portal_course_hash;
      }
    } catch (e) {}
  }

  if (!courseHash) {
    try {
      const { resolveActiveSemester } = await import('./attendance/portal-api.js');
      const resolved = await resolveActiveSemester(cleanToken);
      if (resolved && resolved.semesterHash && resolved.semesterHash !== 'h') {
        courseHash = resolved.semesterHash;
        await chrome.storage.local.set({ nst_portal_course_hash: courseHash });
      }
    } catch (e) {
      console.warn('[QuizClient] Unable to resolve active semester from portal-api:', e);
    }
  }

  if (!courseHash) {
    throw new Error('Unable to resolve active semester course hash from LMS');
  }

  if (onProgress) onProgress({ stage: 'listing', message: 'Fetching completed assessments list from LMS...' });

  // 2. Fetch completed assessments
  const assessments = await fetchCompletedAssessmentsFromLMS(cleanToken, courseHash);
  console.log(`[QuizClient] Found ${assessments.length} completed assessments on LMS for semester ${courseHash}`);

  const summary = {
    totalFound: assessments.length,
    alreadyExisted: 0,
    newlyArchived: 0,
    failed: 0
  };

  if (assessments.length === 0) {
    await chrome.storage.local.set({
      quiz_history_synced_at: Date.now(),
      quiz_sync_summary: summary
    });
    return { status: 'SUCCESS', summary };
  }

  // 3. Batch check existing assessments in Supabase to determine what is missing
  const assessmentHashes = assessments.map(item => item.hash).filter(Boolean);
  const existingMap = await batchCheckExistingAssessmentsInSupabase(assessmentHashes);

  const missingAssessments = [];
  for (const item of assessments) {
    const assessmentHash = item.hash;
    if (!assessmentHash) continue;

    const existing = existingMap.get(assessmentHash);
    if (existing && existing.hasAnswersRevealed) {
      summary.alreadyExisted += 1;
    } else {
      missingAssessments.push(item);
    }
  }

  console.log(`[QuizClient] Historical assessment check: ${summary.alreadyExisted} already in Supabase, ${missingAssessments.length} missing from server.`);

  const quizzesToSave = [];

  // 4. Extract questions from Newton LMS for any missing assessments
  for (let i = 0; i < missingAssessments.length; i++) {
    const item = missingAssessments[i];
    const assessmentHash = item.hash;
    const childCourseHash = item.course?.hash || courseHash;
    const title = item.title || 'Quiz Assessment';

    if (onProgress) {
      onProgress({
        stage: 'processing',
        current: i + 1,
        total: missingAssessments.length,
        title,
        message: `Extracting assessment ${i + 1}/${missingAssessments.length}: ${title}`
      });
    }

    try {
      const rawQuestions = await fetchAssessmentQuestionsFromLMS(cleanToken, childCourseHash, assessmentHash);
      if (rawQuestions && rawQuestions.length > 0) {
        const normalized = normalizeNewtonQuestions(rawQuestions);
        const hasSolutions = normalized.some(q => q.correctChoice !== null || q.correctExplanation !== null);

        quizzesToSave.push({
          assessmentHash,
          courseHash: childCourseHash,
          title,
          totalQuestions: normalized.length,
          hasAnswersRevealed: hasSolutions,
          questions: normalized
        });
      } else {
        summary.failed += 1;
      }
    } catch (itemErr) {
      console.warn(`[QuizClient] Error processing assessment ${assessmentHash}:`, itemErr);
      summary.failed += 1;
    }
  }

  // 5. Batch save unarchived quizzes to Supabase
  if (quizzesToSave.length > 0) {
    if (onProgress) {
      onProgress({
        stage: 'saving',
        count: quizzesToSave.length,
        message: `Saving ${quizzesToSave.length} quiz(zes) to Supabase...`
      });
    }

    await batchSaveQuizzesToSupabase(quizzesToSave, uid);
    summary.newlyArchived = quizzesToSave.length;
    console.log(`[QuizClient] Batch-archived ${quizzesToSave.length} missing quizzes into Supabase.`);
  }

  // 6. Update local storage sync state
  await chrome.storage.local.set({
    quiz_history_synced_at: Date.now(),
    quiz_sync_summary: summary
  });

  return { status: 'SUCCESS', summary };
}

/**
 * Real-time interceptor when student submits a quiz
 */
export async function handleQuizSubmissionArchival(courseHash, assessmentHash, authToken) {
  if (!assessmentHash || assessmentHash === 'h') {
    console.warn('[QuizClient] Missing or invalid assessmentHash, skipping archival.');
    return null;
  }

  let token = extractCleanAuthToken(authToken);
  if (!token && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get(['nst_auth_token']);
      if (stored.nst_auth_token) {
        token = extractCleanAuthToken(stored.nst_auth_token);
      }
    } catch (e) {}
  }

  if (!token && typeof localStorage !== 'undefined') {
    try {
      token = extractCleanAuthToken(
        localStorage.getItem('auth-token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('auth_token')
      );
    } catch (e) {}
  }

  if (!token) {
    console.warn('[QuizClient] No auth token available, cannot archive quiz.');
    return null;
  }

  try {
    // 1. Check Supabase first - if verified solutions already exist, don't overwrite
    const existing = await checkSolutionsInSupabase(assessmentHash);
    if (existing.exists && existing.hasAnswers) {
      console.log(`[QuizClient] Solutions for ${assessmentHash} already exist in Supabase.`);
      return { status: 'CACHE_HIT', data: existing.data };
    }

    // Resolve courseHash if missing or invalid
    let effectiveCourseHash = (courseHash && courseHash !== 'h') ? courseHash : null;
    if (!effectiveCourseHash && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const stored = await chrome.storage.local.get(['nst_portal_course_hash']);
        if (stored.nst_portal_course_hash && stored.nst_portal_course_hash !== 'h') {
          effectiveCourseHash = stored.nst_portal_course_hash;
        }
      } catch (e) {}
    }

    if (!effectiveCourseHash) {
      try {
        const { resolveActiveSemester } = await import('./attendance/portal-api.js');
        const resolved = await resolveActiveSemester(token);
        if (resolved && resolved.semesterHash && resolved.semesterHash !== 'h') {
          effectiveCourseHash = resolved.semesterHash;
        }
      } catch (e) {
        console.warn('[QuizClient] Could not resolve active semester in submission archival:', e);
      }
    }

    if (!effectiveCourseHash) {
      console.warn('[QuizClient] Missing courseHash, cannot fetch questions from LMS.');
      return null;
    }

    // 2. Brief wait for LMS to finalize submission
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // 3. Fetch questions & answers from LMS using student's browser session
    let rawQuestions = await fetchAssessmentQuestionsFromLMS(token, effectiveCourseHash, assessmentHash);
    let normalized = normalizeNewtonQuestions(rawQuestions);
    let hasSolutions = normalized.some(q => q.correctChoice !== null || q.correctExplanation !== null);

    // If answers are not immediately visible, retry once after a short delay
    if (!hasSolutions && rawQuestions && rawQuestions.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const retryRaw = await fetchAssessmentQuestionsFromLMS(token, effectiveCourseHash, assessmentHash);
        const retryNorm = normalizeNewtonQuestions(retryRaw);
        if (retryNorm.some(q => q.correctChoice !== null || q.correctExplanation !== null)) {
          normalized = retryNorm;
          hasSolutions = true;
        }
      } catch (retryErr) {
        console.warn('[QuizClient] Retry questions fetch failed:', retryErr);
      }
    }

    // 4. Save to Supabase
    const result = await saveQuizSolutionToSupabase(effectiveCourseHash, assessmentHash, {
      title: 'Quiz Assessment',
      questions: normalized,
      hasAnswersRevealed: hasSolutions
    });

    console.log('[QuizClient] Quiz solutions archived successfully to Supabase:', result);
    return result;
  } catch (err) {
    console.error('[QuizClient] Failed to handle quiz archival:', err);
    return { error: err.message };
  }
}
