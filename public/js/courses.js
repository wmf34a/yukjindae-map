function courseCardHtml(course, places) {
  const thumb = course.image
    ? `<img class="course-card__thumb" src="${escapeHtml(safeImageSrc(course.image))}" alt="${escapeHtml(course.name)}" loading="lazy" />`
    : `<div class="course-card__thumb"></div>`;

  const stops = course.placeIds
    .map((id) => places.find((p) => p.id === id))
    .filter(Boolean);

  const stopsHtml = stops
    .map(
      (place, i) => `
      <a class="course-card__stop" href="place.html?id=${encodeURIComponent(place.id)}">
        <span class="course-card__stop-num">${i + 1}</span>
        <span class="course-card__stop-name">${escapeHtml(place.name)}</span>
      </a>`
    )
    .join("");

  const routeBtn =
    stops.length >= 2
      ? `<button type="button" class="course-directions-btn" data-course-route="${course.id}">거리·시간 보기</button>`
      : "";

  return `
    <div class="course-card">
      <button type="button" class="course-card__header" data-course-toggle>
        ${thumb}
        <div class="course-card__body">
          <p class="course-card__name">${escapeHtml(course.name)}</p>
          ${course.description ? `<p class="course-card__desc">${escapeHtml(course.description)}</p>` : ""}
          <p class="course-card__count">${stops.length}곳</p>
        </div>
      </button>
      <div class="course-card__stops" hidden>${stopsHtml}${routeBtn}</div>
    </div>
  `;
}

async function loadCourses() {
  const list = document.getElementById("course-list");
  try {
    const [coursesData, placesData] = await Promise.all([
      fetchJson("/api/courses"),
      fetchJson("/api/places"),
    ]);
    const courses = coursesData.courses || [];
    const places = placesData.places || [];

    list.innerHTML = courses.length
      ? courses.map((c) => courseCardHtml(c, places)).join("")
      : `<p class="place-list__empty">반나절 나들이하기 좋은 테마별 코스를 모아서 곧 보여드릴게요.</p>`;

    list.querySelectorAll("[data-course-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stopsEl = btn.nextElementSibling;
        stopsEl.hidden = !stopsEl.hidden;
        btn.closest(".course-card").classList.toggle("is-open", !stopsEl.hidden);
      });
    });

    list.querySelectorAll("[data-course-route]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const course = courses.find((c) => c.id === btn.dataset.courseRoute);
        if (course) window.openThemeCourseModal(course, places);
      });
    });
  } catch {
    list.innerHTML = `<p class="place-list__empty">코스 정보를 불러오지 못했어요.</p>`;
  }
}

loadCourses();
