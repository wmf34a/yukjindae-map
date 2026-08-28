// 처음 온 사람에게 앱에 뭐가 있는지 한 번 보여준다.
//
// 지도를 눌러 지역을 고르는 것도, 코스보기가 근처 맛집·카페까지 묶어 준다는 것도
// 화면만 봐서는 알기 어렵다. 첫 방문에 카드 몇 장으로 훑고, 다시 보지 않기를
// 누르면 그걸로 끝난다.
//
// 설치 유도 팝업과 겹치면 두 개가 한꺼번에 뜬다. 튜토리얼이 먼저 닫힌 뒤에
// 설치 팝업이 뜨도록 pwa.js가 이 플래그를 본다.

const TOUR_SEEN_KEY = "yukjindae_tour_seen";

const SLIDES = [
  {
    icon: "🗺️",
    title: "지도에서 지역을 골라요",
    body: "지역을 누르면 그 달에 가기 좋은 순서로 Top 10을 보여줘요. 매달 1일에 계절에 맞게 다시 뽑아요.",
  },
  {
    icon: "🍴",
    title: "코스로 하루를 짜요",
    body: "장소 상세에서 코스보기를 누르면 근처 맛집·카페까지 묶어 지도에 그려줘요. 길찾기도 바로 열려요.",
  },
  {
    icon: "🍼",
    title: "아이랑 갈 수 있는지 먼저 봐요",
    body: "수유실, 기저귀교환대, 유아의자, 무료입장 연령을 장소마다 표시해요.",
  },
  {
    icon: "📍",
    title: "좋았던 곳을 알려주세요",
    body: "아빠가 직접 다녀온 곳을 추천하면 지도에 올라가요. 정보가 틀렸을 때 제보도 받아요.",
  },
];

let index = 0;

function hasSeen() {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    // 시크릿 모드 등에서 저장소가 막히면 매번 보여주는 것보다 건너뛰는 편이 낫다.
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // 저장에 실패해도 이번 방문에서는 닫힌다.
  }
}

function close() {
  markSeen();
  document.querySelector(".tour-overlay")?.remove();
  // 설치 팝업이 기다리고 있다면 이제 띄운다.
  window.dispatchEvent(new CustomEvent("yukjindae:tour-closed"));
}

function render(overlay) {
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  overlay.querySelector(".tour__icon").textContent = slide.icon;
  overlay.querySelector(".tour__title").textContent = slide.title;
  overlay.querySelector(".tour__body").textContent = slide.body;
  overlay.querySelector(".tour__next").textContent = isLast ? "시작하기" : "다음";

  const dots = overlay.querySelector(".tour__dots");
  dots.innerHTML = SLIDES.map(
    (_, i) => `<span class="tour__dot${i === index ? " is-active" : ""}"></span>`
  ).join("");
}

function open() {
  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  overlay.innerHTML = `
    <div class="tour" role="dialog" aria-modal="true" aria-label="육진대 맵 사용법">
      <button type="button" class="tour__skip">건너뛰기</button>
      <div class="tour__icon" aria-hidden="true"></div>
      <h2 class="tour__title"></h2>
      <p class="tour__body"></p>
      <div class="tour__dots"></div>
      <button type="button" class="tour__next"></button>
    </div>
  `;
  document.body.append(overlay);
  render(overlay);

  overlay.querySelector(".tour__skip").addEventListener("click", close);
  overlay.querySelector(".tour__next").addEventListener("click", () => {
    if (index === SLIDES.length - 1) {
      close();
      return;
    }
    index += 1;
    render(overlay);
  });
  // 바깥을 눌러도 닫힌다. 안쪽 클릭까지 닫히면 다음 버튼을 못 누른다.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// 튜토리얼이 떠 있는 동안에는 설치 팝업을 미룬다.
window.yukjindaeTourPending = !hasSeen();

document.addEventListener("DOMContentLoaded", () => {
  if (hasSeen()) return;
  open();
});
