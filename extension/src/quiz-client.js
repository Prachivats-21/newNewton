/**
 * Newton Enhancer - Quiz Solution Client & Interceptor
 * Powered by Supabase Edge Functions (AWS Mumbai ap-south-1)
 *
 * Security Architecture:
 * 1. CLIENT HAS ZERO WRITE ACCESS TO THE DATABASE (Enforced by PostgreSQL Table Privileges & RLS)
 * 2. CLIENT NEVER FETCHES QUIZ ANSWERS
 * 3. Client only sends the student's auth-token and course/assessment hashes to the Supabase Edge Function
 * 4. Supabase Edge Function (running in AWS Mumbai) fetches authentic solutions directly from Newton LMS
 *    and writes them into the PostgreSQL database using service role privileges
 * 5. Client only performs read-only checks to see if verified solutions already exist
 */

export const SUPABASE_CONFIG = {
  url: 'https://wwxqskccvcpimcgctskm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eHFza2NjdmNwaW1jZ2N0c2ttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjM2MjgsImV4cCI6MjEwNzI5OTYyOH0.uEXGkzcIXbqyU5lRnFVyAF0c04YI0SoED6p98EYrbcc',
  edgeFunctionUrl: 'https://wwxqskccvcpimcgctskm.supabase.co/functions/v1/sync-quizzes'
};

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
 * Read-Only Check: Checks if verified solutions exist in Supabase via PostgREST API
 * (Clients only have SELECT privileges on the quizzes table)
 *
 * @param {string} assessmentHash
 * @returns {Promise<{exists: boolean, hasAnswers?: boolean, data?: object}>}
 */
export async function checkSolutionsInSupabase(assessmentHash) {
  if (!assessmentHash || !SUPABASE_CONFIG.url) {
    return { exists: false, hasAnswers: false };
  }

  try {
    const cleanHash = assessmentHash.replace(/^h\//i, '').replace(/^\/+|\/+$/g, '');
    const url = `${SUPABASE_CONFIG.url}/rest/v1/quizzes?assessment_hash=eq.${encodeURIComponent(cleanHash)}&select=*`;
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
      const hasAnswers = Boolean(doc.has_answers_revealed);

      if (hasQuestions) {
        return {
          exists: true,
          hasAnswers,
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
 * Historical Sync: Sends auth-token to Supabase Edge Function
 * The Edge Function fetches all completed assessments from Newton LMS,
 * checks what is missing in the database, fetches questions, and saves them.
 * Client does not fetch answers or write to the database.
 */
export async function syncHistoricalQuizzes(token, uid = null, preferredCourseHash = null, onProgress = null) {
  const cleanToken = extractCleanAuthToken(token);
  if (!cleanToken) {
    return { status: 'PENDING_AUTH', error: 'No valid auth token found' };
  }

  let courseHash = (preferredCourseHash && preferredCourseHash !== 'h') ? preferredCourseHash : null;
  if (!courseHash && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get(['nst_portal_course_hash']);
      if (stored.nst_portal_course_hash && stored.nst_portal_course_hash !== 'h') {
        courseHash = stored.nst_portal_course_hash;
      }
    } catch (e) {}
  }

  if (onProgress) onProgress({ stage: 'syncing', message: 'Triggering server-side historical sync on Supabase...' });
  console.log('[QuizClient] Delegating historical quiz sync to Supabase Edge Function (AWS Mumbai)...');

  try {
    const res = await fetch(SUPABASE_CONFIG.edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
      },
      body: JSON.stringify({
        action: 'SYNC_ALL',
        authToken: cleanToken,
        courseHash: courseHash || null,
        uid: uid || null
      })
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `Server sync failed: HTTP ${res.status}`);
    }

    console.log('[QuizClient] Server-side historical sync complete:', result);

    const summary = result.summary || { totalFound: 0, alreadyExisted: 0, newlyArchived: 0 };
    await chrome.storage.local.set({
      quiz_history_synced_at: Date.now(),
      quiz_sync_summary: summary
    });

    return { status: 'SUCCESS', summary };
  } catch (err) {
    console.error('[QuizClient] Server-side historical sync failed:', err);
    throw err;
  }
}

/**
 * Quiz Submission Archival:
 * Sends auth-token, courseHash, and assessmentHash to Supabase Edge Function.
 * The Edge Function fetches the quiz answers directly from Newton LMS and saves them.
 * Client does not touch the answers or write to the database.
 */
export async function handleQuizSubmissionArchival(courseHash, assessmentHash, authToken) {
  if (!assessmentHash || assessmentHash === 'h') {
    console.warn('[QuizClient] Invalid assessmentHash, skipping archival.');
    return null;
  }

  let token = extractCleanAuthToken(authToken);
  if (!token && typeof localStorage !== 'undefined') {
    try {
      token = extractCleanAuthToken(localStorage.getItem('auth-token') || localStorage.getItem('token'));
    } catch (e) {}
  }

  if (!token) {
    console.warn('[QuizClient] No auth token available, cannot archive quiz.');
    return null;
  }

  const cleanAssessment = assessmentHash.replace(/^h\//i, '').replace(/^\/+|\/+$/g, '');
  const cleanCourse = (courseHash && courseHash !== 'h') ? courseHash.replace(/^h\//i, '').replace(/^\/+|\/+$/g, '') : null;

  try {
    // 1. Quick read-only check: if already archived with answers, skip calling Edge Function
    const existing = await checkSolutionsInSupabase(cleanAssessment);
    if (existing.exists && existing.hasAnswers) {
      console.log(`[QuizClient] Quiz ${cleanAssessment} already archived with answers in Supabase. Skipping redundant server call.`);
      return { status: 'CACHE_HIT', data: existing.data };
    }

    // 2. Delegate to Supabase Edge Function: Server fetches answers from Newton LMS and saves to DB
    console.log(`[QuizClient] Delegating quiz archival to Supabase Edge Function for ${cleanAssessment}...`);
    const res = await fetch(SUPABASE_CONFIG.edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
      },
      body: JSON.stringify({
        action: 'ARCHIVE_ONE',
        authToken: token,
        courseHash: cleanCourse,
        assessmentHash: cleanAssessment
      })
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `Server archival failed: HTTP ${res.status}`);
    }

    console.log(`[QuizClient] Server archival succeeded for ${cleanAssessment}:`, result);
    return result;
  } catch (err) {
    console.error('[QuizClient] Failed to delegate quiz archival:', err);
    return { error: err.message };
  }
}
