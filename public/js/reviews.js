// 장소 상세의 별점·후기.
//
// 별 다섯 개만 보여주면 이 앱에서는 쓸모가 적다. "여기 4.2점이래"는 아무것도
// 알려주지 않는다. 아빠가 알고 싶은 것은 하나다 — 내 아이 나이에 맞나.
// 그래서 나이대별 평균을 먼저 보여주고 전체 평균은 그 옆에 둔다.

const AGE_BANDS = ["0~2세", "3~5세", "6~8세", "9세 이상"];
const STAY_TIMES = ["1시간 미만", "1~2시간", "반나절", "하루 종일"];
const REVISIT = ["또 갈래요", "한 번이면 충분"];
const MAX_PHOTOS = 3;
const MAX_EDGE = 1600;

// 쓰는 중인 값. 모달을 닫으면 지운다.
let form = { rating: 0, ageBand: null, stayTime: null, revisit: null, photos: [] };
let currentPlace = null;

function stars(n) {
  return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
}

function when(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  return `${then.getFullYear()}.${String(then.getMonth() + 1).padStart(2, "0")}`;
}

function summaryHtml(summary) {
  if (!summary.count) {
    return `<p class="review-empty">아직 후기가 없어요. 다녀오셨다면 첫 후기를 남겨주세요.</p>`;
  }
  const bars = summary.byAge.map((b) => `
    <div class="review-bar">
      <span class="review-bar__label">${escapeHtml(b.band)}</span>
      <span class="review-bar__track"><span class="review-bar__fill" style="width:${(b.average / 5) * 100}%"></span></span>
      <span class="review-bar__value">${b.average}</span>
    </div>
  `).join("");
  const chips = [];
  if (summary.revisit) chips.push(`<span class="review-chip">또 갈래요 ${summary.revisit}</span>`);
  for (const s of summary.stayTimes) {
    chips.push(`<span class="review-chip review-chip--gray">${escapeHtml(s.name)} ${s.count}</span>`);
  }
  return `
    <div class="review-score">
      <p class="review-score__stars">${stars(Math.round(summary.average))}</p>
      <p class="review-score__num">${summary.average}<span>· 후기 ${summary.count}개</span></p>
    </div>
    ${bars ? `<div class="review-bars">${bars}</div>` : ""}
    ${chips.length ? `<div class="review-chips">${chips.join("")}</div>` : ""}
  `;
}

function reviewHtml(r) {
  const photos = (r.photos || []).map((u) => `
    <img class="review-item__photo" src="${escapeHtml(safeImageSrc(u))}" alt="후기 사진" loading="lazy" />
  `).join("");
  return `
    <div class="review-item">
      <div class="review-item__top">
        <span class="review-item__stars">${stars(r.rating)}${r.ageBand ? ` · ${escapeHtml(r.ageBand)}` : ""}</span>
        <span class="review-item__when">${escapeHtml(when(r.createdAt))}</span>
      </div>
      ${r.text ? `<p class="review-item__text">${escapeHtml(r.text)}</p>` : ""}
      ${photos ? `<div class="review-item__photos">${photos}</div>` : ""}
      <button type="button" class="review-item__report" data-review-report="${escapeHtml(r.id)}">신고</button>
    </div>
  `;
}

async function renderReviews(place) {
  currentPlace = place;
  const slot = document.getElementById("review-slot");
  if (!slot) return;

  let data = { reviews: [], summary: { count: 0 } };
  try {
    data = await fetchJson(`/api/reviews?placeId=${encodeURIComponent(place.id)}`);
  } catch {
    slot.remove();
    return;
  }

  const section = document.createElement("div");
  section.className = "place-detail__section";
  section.innerHTML = `
    <p class="place-detail__label">⭐ 아빠들의 평가</p>
    ${summaryHtml(data.summary)}
    <div class="review-list">${data.reviews.slice(0, 5).map(reviewHtml).join("")}</div>
    ${data.reviews.length > 5 ? `<button type="button" class="review-more" id="review-more">후기 ${data.reviews.length - 5}개 더보기</button>` : ""}
    <button type="button" class="review-write" id="review-write">후기 남기기</button>
    <p class="place-detail__source">모든 후기는 확인 후 올라와요</p>
  `;
  slot.replaceWith(section);

  const more = document.getElementById("review-more");
  if (more) {
    more.addEventListener("click", () => {
      section.querySelector(".review-list").innerHTML = data.reviews.map(reviewHtml).join("");
      more.remove();
    });
  }
  document.getElementById("review-write").addEventListener("click", openReviewModal);
  section.querySelectorAll("[data-review-report]").forEach((btn) => {
    btn.addEventListener("click", () => reportReview(btn));
  });
}

// 신고. 누른 뒤 되돌릴 수 없으므로 한 번 묻는다.
//
// 신고해도 후기가 곧바로 사라지지는 않는다 — 신고 하나로 내려가면 신고 자체가
// 남용 수단이 된다. 여러 건이 쌓이면 자동으로 감춰지고, 사람이 확인한다.
async function reportReview(btn) {
  if (btn.disabled) return;
  if (!window.confirm("이 후기를 신고할까요? 확인 후 조치합니다.")) return;
  btn.disabled = true;
  btn.textContent = "접수 중...";
  try {
    const res = await fetch(window.apiUrl("/api/reviews/report"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: btn.dataset.reviewReport }),
    });
    if (!res.ok) throw new Error("접수 실패");
    btn.textContent = "신고했어요";
  } catch {
    btn.textContent = "신고";
    btn.disabled = false;
  }
}

// 사진은 브라우저에서 줄여 보낸다. 서버에서 다시 그리면 변환 비용이 붙고,
// 캔버스로 다시 그리는 과정에서 EXIF(GPS·촬영시각)가 통째로 사라진다.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 읽지 못했어요."));
    };
    img.src = url;
  });
}

function chipRow(name, values, selected) {
  return values.map((v) => `
    <button type="button" class="review-opt${selected === v ? " is-on" : ""}" data-${name}="${escapeHtml(v)}">${escapeHtml(v)}</button>
  `).join("");
}

function renderForm() {
  const body = document.getElementById("review-modal-body");
  body.innerHTML = `
    <p class="report-modal__label">얼마나 좋았나요?</p>
    <div class="review-stars" id="review-stars">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="review-star${n <= form.rating ? " is-on" : ""}" data-star="${n}" aria-label="${n}점">★</button>`).join("")}
    </div>

    <p class="report-modal__label">누구와 갔나요? <span class="review-optional">선택</span></p>
    <div class="review-opts">${chipRow("age", AGE_BANDS, form.ageBand)}</div>

    <p class="report-modal__label">얼마나 머물렀나요? <span class="review-optional">선택</span></p>
    <div class="review-opts">${chipRow("stay", STAY_TIMES, form.stayTime)}</div>

    <p class="report-modal__label">또 가실 건가요? <span class="review-optional">선택</span></p>
    <div class="review-opts">${chipRow("revisit", REVISIT, form.revisit)}</div>

    <label class="report-modal__label" for="review-text">한 줄 후기 <span class="review-optional">선택</span></label>
    <textarea id="review-text" class="report-modal__value-input report-modal__textarea" rows="3" maxlength="200"
      placeholder="예: 실내라 비 와도 괜찮고, 2층 수유실에 아빠도 들어갈 수 있어요"></textarea>

    <p class="report-modal__label">사진 <span class="review-optional">선택 · 최대 ${MAX_PHOTOS}장</span></p>
    <div class="review-photos" id="review-photos">
      ${form.photos.map((p, i) => `
        <div class="review-photo">
          <img src="${p}" alt="올린 사진" />
          <button type="button" class="review-photo__x" data-photo-remove="${i}" aria-label="사진 빼기">✕</button>
        </div>
      `).join("")}
      ${form.photos.length < MAX_PHOTOS ? `<button type="button" class="review-photo__add" id="review-photo-add">＋</button>` : ""}
    </div>
    <input type="file" id="review-photo-input" accept="image/*" hidden />
    <p class="report-modal__hint">다른 집 아이가 나온 사진은 올리지 말아주세요. 모든 후기는 확인 후 올라옵니다.</p>
    <p class="report-modal__error" id="review-error" hidden></p>
  `;
  bindForm();
}

function bindForm() {
  const body = document.getElementById("review-modal-body");

  body.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", () => {
      form.rating = Number(btn.dataset.star);
      renderForm();
      updateSubmit();
    });
  });

  const toggle = (attr, field) => {
    body.querySelectorAll(`[data-${attr}]`).forEach((btn) => {
      btn.addEventListener("click", () => {
        // 한 번 더 누르면 해제한다. 선택 항목이라 되돌릴 수 있어야 한다.
        form[field] = form[field] === btn.dataset[attr] ? null : btn.dataset[attr];
        renderForm();
        updateSubmit();
      });
    });
  };
  toggle("age", "ageBand");
  toggle("stay", "stayTime");
  toggle("revisit", "revisit");

  const addBtn = document.getElementById("review-photo-add");
  const input = document.getElementById("review-photo-input");
  if (addBtn && input) {
    addBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        form.photos.push(await shrinkPhoto(file));
        renderForm();
      } catch (err) {
        const el = document.getElementById("review-error");
        el.textContent = err.message;
        el.hidden = false;
      }
      input.value = "";
    });
  }
  body.querySelectorAll("[data-photo-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      form.photos.splice(Number(btn.dataset.photoRemove), 1);
      renderForm();
    });
  });
}

function updateSubmit() {
  const btn = document.getElementById("review-submit");
  if (btn) btn.disabled = !form.rating;
}

function openReviewModal() {
  form = { rating: 0, ageBand: null, stayTime: null, revisit: null, photos: [] };
  const overlay = document.getElementById("review-modal-overlay");
  overlay.classList.add("is-open");
  document.body.style.overflow = "hidden";
  document.getElementById("review-success").hidden = true;
  document.getElementById("review-submit").textContent = "후기 남기기";
  renderForm();
  updateSubmit();
}

function closeReviewModal() {
  document.getElementById("review-modal-overlay").classList.remove("is-open");
  document.body.style.overflow = "";
}

async function submitReview() {
  const btn = document.getElementById("review-submit");
  const err = document.getElementById("review-error");
  btn.disabled = true;
  btn.textContent = "보내는 중...";
  if (err) err.hidden = true;
  try {
    const res = await fetch(window.apiUrl("/api/reviews"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        placeId: currentPlace.id,
        placeName: currentPlace.name,
        rating: String(form.rating),
        ageBand: form.ageBand,
        stayTime: form.stayTime,
        revisit: form.revisit,
        text: (document.getElementById("review-text") || {}).value || "",
        photos: form.photos,
        authorKey: window.deviceId(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "후기를 보내지 못했어요.");
    document.getElementById("review-success").hidden = false;
    btn.textContent = "보냈어요";
    setTimeout(closeReviewModal, 1600);
  } catch (e) {
    if (err) {
      err.textContent = e.message;
      err.hidden = false;
    }
    btn.disabled = false;
    btn.textContent = "후기 남기기";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const close = document.getElementById("review-modal-close");
  if (close) close.addEventListener("click", closeReviewModal);
  const overlay = document.getElementById("review-modal-overlay");
  if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) closeReviewModal(); });
  const submit = document.getElementById("review-submit");
  if (submit) submit.addEventListener("click", submitReview);
});

window.renderReviews = renderReviews;
