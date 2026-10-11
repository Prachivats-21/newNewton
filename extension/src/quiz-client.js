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
  url: 'https://YOUR_PROJECT_ID.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY'
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
    tokenStr = parsed.token || parsed.access_token || parsed.authToken || null;
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
    const mcq = q.multiple_choice_question || {};
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
    return { exists: false };
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
      return { exists: false };
    }

    const list = await resp.json();
    if (Array.isArray(list) && list.length > 0) {
      const doc = list[0];
      const hasQuestions = Array.isArray(doc.questions) && doc.questions.length > 0;
      if (hasQuestions) {
        return {
          exists: true,
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

    return { exists: false };
  } catch (err) {
    console.warn('[QuizClient] Could not check Supabase cache:', err);
    return { exists: false };
  }
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

  const url = `https://my.newtonschool.co/api/v2/course/h/${courseHash}/assessment/all/?attempt_statuses=3&limit=100&offset=0`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${clean}`
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch completed assessments: HTTP ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
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
  let courseHash = preferredCourseHash;
  if (!courseHash) {
    const { resolveActiveSemester } = await import('./attendance/portal-api.js');
    const resolved = await resolveActiveSemester(cleanToken);
    if (resolved && resolved.semesterHash) {
      courseHash = resolved.semesterHash;
      await chrome.storage.local.set({ nst_portal_course_hash: courseHash });
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

  const quizzesToSave = [];

  // 3. Process each assessment
  for (let i = 0; i < assessments.length; i++) {
    const item = assessments[i];
    const assessmentHash = item.hash;
    const childCourseHash = item.course?.hash || courseHash;
    const title = item.title || 'Quiz Assessment';

    if (!assessmentHash) continue;

    if (onProgress) {
      onProgress({
        stage: 'processing',
        current: i + 1,
        total: assessments.length,
        title,
        message: `Checking assessment ${i + 1}/${assessments.length}: ${title}`
      });
    }

    try {
      // Check Supabase cache first
      const existing = await checkSolutionsInSupabase(assessmentHash);
      if (existing.exists) {
        summary.alreadyExisted += 1;
        continue;
      }

      // Fetch questions from LMS
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

  // 4. Batch save unarchived quizzes to Supabase
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
  }

  // 5. Update local storage sync state
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
  if (!courseHash || !assessmentHash) {
    console.warn('[QuizClient] Missing courseHash or assessmentHash, skipping archival.');
    return null;
  }

  let token = extractCleanAuthToken(authToken);
  if (!token && typeof localStorage !== 'undefined') {
    try {
      token = extractCleanAuthToken(localStorage.getItem('auth-token'));
    } catch (e) {}
  }

  if (!token) {
    console.warn('[QuizClient] No auth token available, cannot archive quiz.');
    return null;
  }

  try {
    // 1. Check Supabase first
    const existing = await checkSolutionsInSupabase(assessmentHash);
    if (existing.exists) {
      return { status: 'CACHE_HIT', data: existing.data };
    }

    // 2. Fetch questions from LMS using student's browser session
    const rawQuestions = await fetchAssessmentQuestionsFromLMS(token, courseHash, assessmentHash);
    const normalized = normalizeNewtonQuestions(rawQuestions);
    const hasSolutions = normalized.some(q => q.correctChoice !== null || q.correctExplanation !== null);

    // 3. Save to Supabase
    const result = await saveQuizSolutionToSupabase(courseHash, assessmentHash, {
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
