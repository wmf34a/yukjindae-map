function courseCardHtml(course, places) {
  const thumb = course.image
    ? `<img class="course-card__thumb" src="${course.image}" alt="${course.name}" loading="lazy" />`
    : `<div class="course-card__thumb"></div>`;

  const stops = course.placeIds
    .map((id) => places.find((p) => p.id === id))
    .filter(Boolean);

  const stopsHtml = stops
    .map(
      (place, i) => `
      <a class="course-card__stop" href="place.html?id=${place.id}">
        <span class="course-card__stop-num">${i + 1}</span>
        <span class="course-card__stop-name">${place.name}</span>
      </a>`
    )
    .join("");

  return `
    <div class="course-card">
      <button type="button" class="course-card__header" data-course-toggle>
        ${thumb}
        <div class="course-card__body">
          <p class="course-card__name">${course.name}</p>
          ${course.description ? `<p class="course-card__desc">${course.description}</p>` : ""}
          <p class="course-card__count">${stops.length}곳</p>
        </div>
      </button>
      <div class="course-card__stops" hidden>${stopsHtml}</div>
    </div>
  `;
}

async function loadCourses() {
  const list = document.getElementById("course-list");
  try {
    const [coursesRes, placesRes] = await Promise.all([
      fetch("/api/courses"),
      fetch("/api/places"),
    ]);
    const coursesData = await coursesRes.json();
    const placesData = await placesRes.json();
    const courses = coursesData.courses || [];
    const places = placesData.places || [];

    list.innerHTML = courses.length
      ? courses.map((c) => courseCardHtml(c, places)).join("")
      : `<p class="place-list__empty">반나절 나들이하기 좋은 테마별 코스를 모아서 곧 보여드릴게요.</p>`;

    list.querySelectorAll("[data-course-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stopsEl = btn.nextElementSibling;
        stopsEl.hidden = !stopsEl.hidden;
      });
    });
  } catch {
    list.innerHTML = `<p class="place-list__empty">코스 정보를 불러오지 못했어요.</p>`;
  }
}

loadCourses();
