// 로그인. 구글·카카오는 Supabase 가 대신 처리한다.
//
// 로그인은 선택이다. 하지 않아도 지금까지처럼 전부 쓰인다 — 찜도 브라우저에 그대로
// 남는다. 로그인으로 얻는 것은 "기기를 옮겨도 찜이 따라오는 것" 하나뿐이다.
//
// 그래서 이 파일은 실패에 관대하다. Supabase 가 설정되지 않았거나, 네트워크가
// 끊겼거나, SDK 로드가 막혀도 앱의 나머지는 멀쩡해야 한다.

const SUPABASE_SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

let clientPromise = null;
let cachedUser = null;
const listeners = new Set();

function config() {
  const env = window.__ENV__ || {};
  return { url: env.SUPABASE_URL || "", key: env.SUPABASE_ANON_KEY || "" };
}

// 로그인 기능을 켤 수 있는 상태인지. 키가 없으면 버튼 자체를 그리지 않는다 —
// 눌렀는데 아무 일도 안 일어나는 버튼이 제일 나쁘다.
function authAvailable() {
  const { url, key } = config();
  return Boolean(url && key);
}

function loadSdk() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SUPABASE_SDK}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("SDK 로드 실패")));
      return;
    }
    const tag = document.createElement("script");
    tag.src = SUPABASE_SDK;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error("SDK 로드 실패"));
    document.head.appendChild(tag);
  });
}

// 클라이언트는 한 번만 만든다. 페이지마다 새로 만들면 세션 복원이 중복으로 돈다.
function getClient() {
  if (!authAvailable()) return Promise.resolve(null);
  if (clientPromise) return clientPromise;
  const { url, key } = config();
  clientPromise = loadSdk()
    .then(() =>
      window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    )
    .catch((err) => {
      console.warn("[auth] 준비 실패", err);
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

function notify(user) {
  cachedUser = user;
  for (const fn of listeners) {
    try {
      fn(user);
    } catch (err) {
      console.warn("[auth] 리스너 오류", err);
    }
  }
}

// 로그인 상태가 바뀔 때마다 부른다. 등록 즉시 지금 상태로 한 번 부르므로,
// 호출부는 "처음 그리기"와 "바뀔 때 다시 그리기"를 같은 코드로 처리하면 된다.
function onAuthChange(callback) {
  listeners.add(callback);
  callback(cachedUser);
  return () => listeners.delete(callback);
}

function currentUser() {
  return cachedUser;
}

// 표시용 이름. 카카오는 이메일을 주지 않을 수 있어서(비즈 앱 전환 전) 닉네임을 먼저 본다.
function displayName(user) {
  if (!user) return "";
  const meta = user.user_metadata || {};
  return meta.name || meta.full_name || meta.nickname || user.email || "로그인됨";
}

async function signIn(provider) {
  const client = await getClient();
  if (!client) return;
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      // 로그인 뒤 원래 보던 화면으로 돌아온다. 찜 페이지에서 눌렀는데 홈으로
      // 떨어지면 방금 뭘 하려 했는지 잊게 된다.
      redirectTo: window.location.href.split("#")[0],
    },
  });
  if (error) {
    console.warn("[auth] 로그인 실패", error);
    window.showToast?.("로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}

async function signOut() {
  const client = await getClient();
  if (!client) return;
  await client.auth.signOut();
  notify(null);
}

// 로그인한 사람의 찜을 서버에서 읽는다. 실패하면 null 을 준다 —
// 빈 배열과 구분해야 한다. "서버에 없다"와 "못 읽었다"를 같이 다루면
// 못 읽은 순간 로컬 찜을 지우게 된다.
async function fetchRemoteFavorites() {
  const client = await getClient();
  if (!client || !cachedUser) return null;
  const { data, error } = await client
    .from("favorites")
    .select("place_id")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[auth] 찜 읽기 실패", error);
    return null;
  }
  return (data || []).map((row) => row.place_id);
}

// 서버 목록을 통째로 맞춘다. 지울 것과 넣을 것만 추린다 — 매번 전부 지우고
// 다시 넣으면 created_at 이 바뀌어 "최근 찜한 순"이 무너진다.
async function pushFavorites(ids) {
  const client = await getClient();
  if (!client || !cachedUser) return false;
  const remote = await fetchRemoteFavorites();
  if (remote === null) return false;

  const userId = cachedUser.id;
  const want = new Set(ids);
  const have = new Set(remote);
  const toAdd = ids.filter((id) => !have.has(id));
  const toRemove = remote.filter((id) => !want.has(id));

  if (toRemove.length) {
    const { error } = await client.from("favorites").delete().in("place_id", toRemove);
    if (error) {
      console.warn("[auth] 찜 삭제 실패", error);
      return false;
    }
  }
  if (toAdd.length) {
    // 배열 앞쪽이 최근 찜한 것이라, 뒤로 갈수록 과거 시각을 준다.
    const now = Date.now();
    const rows = toAdd.map((placeId) => ({
      user_id: userId,
      place_id: placeId,
      created_at: new Date(now - ids.indexOf(placeId) * 1000).toISOString(),
    }));
    const { error } = await client.from("favorites").insert(rows);
    if (error) {
      console.warn("[auth] 찜 저장 실패", error);
      return false;
    }
  }
  return true;
}

// 로그인 직후 한 번 부른다. 어느 쪽도 지우지 않고 합친다 — 두 기기에서 각각
// 찜해 둔 사람이 양쪽에서 로그인하면 늘어나기만 해야 한다.
async function mergeOnLogin() {
  const remote = await fetchRemoteFavorites();
  if (remote === null) return; // 못 읽었으면 아무것도 하지 않는다. 로컬을 건드리면 잃는다.
  const local = window.getFavorites ? window.getFavorites() : [];
  const merged = remote.slice();
  const seen = new Set(merged);
  for (const id of local) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  // push:false — 바로 아래에서 한 번에 밀어 넣는다. 여기서 또 부르면 같은 요청이 두 번 나간다.
  window.setFavorites?.(merged, { push: false });
  await pushFavorites(merged);
}

async function init() {
  if (!authAvailable()) return;
  const client = await getClient();
  if (!client) return;

  const { data } = await client.auth.getSession();
  const user = data?.session?.user || null;
  notify(user);
  if (user) await mergeOnLogin();

  client.auth.onAuthStateChange(async (event, session) => {
    const next = session?.user || null;
    const wasLoggedOut = !cachedUser;
    notify(next);
    if (next && wasLoggedOut) await mergeOnLogin();
  });
}

window.yukAuth = {
  authAvailable,
  onAuthChange,
  currentUser,
  displayName,
  signIn,
  signOut,
  pushFavorites,
  fetchRemoteFavorites,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
