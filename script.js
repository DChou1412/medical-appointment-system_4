// =========================
// APP STATE
// =========================
const state = {
  symptom: "",
  predictedSpecialty: "",
  topPredictions: [],
  warning: null,
  doctors: [],
  selectedDoctor: null,
  selectedSlot: null,
  bookingResult: null,
  slotCache: {},
};

// =========================
// DOM HELPERS
// =========================
function $(id) {
  return document.getElementById(id);
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = $(screenId);
  if (target) {
    target.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function safeText(value) {
  return value ?? "";
}

// =========================
// FORMAT HELPERS
// =========================
function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "Liên hệ";
  return Number(value).toLocaleString("vi-VN") + "đ";
}

function formatRating(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  return `${value}/5`;
}

function formatDoctorName(doctor) {
  const title = safeText(doctor.title).trim();
  let name = safeText(doctor.doctor_name).trim();

  if (title && name.startsWith("BS ")) {
    name = name.replace(/^BS\s+/, "");
  }

  return `${title} ${name}`.trim();
}

function formatSlotRange(start, end) {
  if (!start || !end) return "-";

  const startDate = new Date(start.replace(" ", "T"));
  const endDate = new Date(end.replace(" ", "T"));

  if (isNaN(startDate) || isNaN(endDate)) {
    return `${start} → ${end}`;
  }

  const day = String(startDate.getDate()).padStart(2, "0");
  const month = String(startDate.getMonth() + 1).padStart(2, "0");
  const startHour = String(startDate.getHours()).padStart(2, "0");
  const startMinute = String(startDate.getMinutes()).padStart(2, "0");
  const endHour = String(endDate.getHours()).padStart(2, "0");
  const endMinute = String(endDate.getMinutes()).padStart(2, "0");

  return `${day}/${month} · ${startHour}:${startMinute} - ${endHour}:${endMinute}`;
}

// =========================
// API HELPERS
// =========================
async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

// =========================
// RENDER: TOP PREDICTIONS
// =========================
function renderTopPredictions(items) {
  const container = $("top-predictions-list");
  if (!container) return;

  container.innerHTML = "";

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="empty-card">
        <h3>Chưa có dữ liệu dự đoán</h3>
        <p>Hệ thống chưa trả về top prediction.</p>
      </div>
    `;
    return;
  }

  items.forEach((item, index) => {
    const score = typeof item.score === "number"
      ? `${Math.round(item.score * 100)}%`
      : "-";

    const card = document.createElement("div");
    card.className = "prediction-item";
    card.innerHTML = `
      <div class="prediction-rank">#${index + 1}</div>
      <div class="prediction-specialty">${safeText(item.specialty)}</div>
      <div class="prediction-score">${score}</div>
    `;
    container.appendChild(card);
  });
}

// =========================
// RENDER: INLINE SLOTS
// =========================
function renderInlineSlots(container, doctorId, slots) {
  if (!container) return;

  if (!slots || slots.length === 0) {
    container.innerHTML = `
      <div class="empty-card" style="margin-top:16px;">
        <h3>Không có lịch trống</h3>
        <p>Hiện tại bác sĩ này chưa có khung giờ khả dụng.</p>
      </div>
    `;
    return;
  }

  const slotItems = slots.map((slot) => {
    return `
      <button
        class="btn btn-secondary inline-slot-btn"
        data-doctor-id="${doctorId}"
        data-slot-id="${slot.slot_id}"
        data-slot-start="${slot.slot_start}"
        data-slot-end="${slot.slot_end}"
        type="button"
      >
        ${formatSlotRange(slot.slot_start, slot.slot_end)}
      </button>
    `;
  }).join("");

  container.innerHTML = `
    <div class="summary-box" style="margin-top:16px;">
      <p><strong>Chọn khung giờ khám:</strong></p>
      <div class="inline-slot-list">
        ${slotItems}
      </div>
    </div>
  `;

  container.querySelectorAll(".inline-slot-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const doctor = state.doctors.find(
        (item) => Number(item.doctor_id) === Number(btn.dataset.doctorId)
      );

      const slot = {
        slot_id: Number(btn.dataset.slotId),
        slot_start: btn.dataset.slotStart,
        slot_end: btn.dataset.slotEnd,
      };

      state.selectedDoctor = doctor || null;
      state.selectedSlot = slot;

      $("booking-doctor-name").textContent = formatDoctorName(state.selectedDoctor || {}) || "-";
      $("booking-department").textContent = safeText(state.selectedDoctor?.department) || "-";
      $("booking-slot-time").textContent = formatSlotRange(slot.slot_start, slot.slot_end);

      showScreen("booking-screen");
    });
  });
}

async function toggleDoctorSlots(doctor, slotContainer, toggleBtn) {
  const doctorId = doctor.doctor_id;
  const isOpen = slotContainer.dataset.open === "true";

  if (isOpen) {
    slotContainer.innerHTML = "";
    slotContainer.dataset.open = "false";
    if (toggleBtn) toggleBtn.textContent = "Xem lịch trống";
    return;
  }

  try {
    let slots = state.slotCache[doctorId];

    if (!slots) {
      const result = await apiGet(`/slots/${doctorId}`);
      slots = result.slots || [];
      state.slotCache[doctorId] = slots;
    }

    renderInlineSlots(slotContainer, doctorId, slots);
    slotContainer.dataset.open = "true";
    if (toggleBtn) toggleBtn.textContent = "Ẩn lịch trống";
  } catch (error) {
    slotContainer.innerHTML = `
      <div class="empty-card" style="margin-top:16px;">
        <h3>Lỗi tải lịch</h3>
        <p>${error.message || "Không thể tải lịch trống."}</p>
      </div>
    `;
    slotContainer.dataset.open = "true";
    if (toggleBtn) toggleBtn.textContent = "Ẩn lịch trống";
  }
}

// =========================
// RENDER: DOCTORS FULL INFO
// =========================
function renderDoctors(doctors) {
  const container = $("doctor-list");
  if (!container) return;

  container.innerHTML = "";

  if (!doctors || doctors.length === 0) {
    container.innerHTML = `
      <div class="empty-card">
        <h3>Chưa có dữ liệu bác sĩ</h3>
        <p>Hiện chưa có bác sĩ phù hợp trong dữ liệu demo cho chuyên khoa này.</p>
      </div>
    `;
    return;
  }

  doctors.forEach((doctor) => {
    const card = document.createElement("div");
    card.style.cursor = "pointer";
    card.className = "doctor-card";

    const displayName = formatDoctorName(doctor);

    const avatarHtml = doctor.avatar
      ? `<img src="${doctor.avatar}" alt="${safeText(displayName)}" class="doctor-avatar-image" onerror="this.style.display='none'; this.parentElement.innerHTML='👨‍⚕️';" />`
      : "👨‍⚕️";

    card.innerHTML = `
      <div class="doctor-card-layout">
        <div class="doctor-card-left">
          <div class="doctor-avatar">${avatarHtml}</div>

          <div class="doctor-basic">
            <h3>${safeText(displayName)}</h3>
            <p class="doctor-department">${safeText(doctor.department)}</p>

            <div class="doctor-meta-inline">
              <span>⭐ ${formatRating(doctor.rating)}</span>
              <span>• ${safeText(doctor.experience_years)} năm kinh nghiệm</span>
            </div>
          </div>
        </div>

        <div class="doctor-card-right">
          <div class="doctor-info-grid">
            <p><strong>Nơi làm việc:</strong> ${safeText(doctor.hospital)}</p>
            <p><strong>Thời gian làm việc:</strong> ${safeText(doctor.working_time)}</p>
            <p><strong>Phí khám:</strong> ${formatCurrency(doctor.fee)}</p>
            <p><strong>Số điện thoại:</strong> ${safeText(doctor.phone) || "N/A"}</p>
            <p><strong>Email:</strong> ${safeText(doctor.email) || "N/A"}</p>
          </div>
        </div>
      </div>

      <div class="doctor-description-box">
        <p><strong>Mô tả:</strong> ${safeText(doctor.description) || "Chưa có mô tả."}</p>
      </div>

      <div class="doctor-actions" style="margin-top:16px;">
        <button class="btn btn-primary doctor-slot-btn" type="button">Xem lịch trống</button>
      </div>

      <div class="doctor-slot-expand" data-open="false"></div>
    `;

    const btn = card.querySelector(".doctor-slot-btn");
    const slotExpand = card.querySelector(".doctor-slot-expand");

    btn?.addEventListener("click", async () => {
      await toggleDoctorSlots(doctor, slotExpand, btn);
    });
card.addEventListener("click", (e) => {
  if (e.target.closest(".doctor-slot-btn")) return;

  alert(
    `Tên: ${safeText(displayName)}
Tuổi: ${safeText(doctor.age) || "Chưa cập nhật"}
Chuyên khoa: ${safeText(doctor.department)}
Kinh nghiệm: ${safeText(doctor.experience_years)} năm
Nơi làm việc: ${safeText(doctor.hospital)}
Thời gian làm việc: ${safeText(doctor.working_time)}
Phí khám: ${formatCurrency(doctor.fee)}
SĐT: ${safeText(doctor.phone)}
Email: ${safeText(doctor.email)}
Đánh giá: ${formatRating(doctor.rating)}

Mô tả:
${safeText(doctor.description)}`
  );
});
    container.appendChild(card);
  });
}

// =========================
// RENDER: HISTORY
// =========================
function renderHistory(appointments) {
  const container = $("history-result");
  if (!container) return;

  container.innerHTML = "";

  if (!appointments || appointments.length === 0) {
    container.innerHTML = `
      <div class="empty-card">
        <h3>Không có lịch hẹn</h3>
        <p>Không tìm thấy lịch hẹn nào với số điện thoại đã nhập.</p>
      </div>
    `;
    return;
  }

  appointments.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-card";

    card.innerHTML = `
      <h3>Mã lịch hẹn: #${safeText(item.appointment_id)}</h3>
      <p><strong>Bệnh nhân:</strong> ${safeText(item.patient_name)}</p>
      <p><strong>Số điện thoại:</strong> ${safeText(item.patient_phone)}</p>
      <p><strong>Bác sĩ:</strong> ${safeText(item.doctor_name)}</p>
      <p><strong>Chuyên khoa:</strong> ${safeText(item.department)}</p>
      <p><strong>Khung giờ:</strong> ${formatSlotRange(item.slot_start, item.slot_end)}</p>
      <p><strong>Trạng thái:</strong> ${safeText(item.status)}</p>
      <p><strong>Ngày tạo:</strong> ${safeText(item.created_at)}</p>
    `;

    container.appendChild(card);
  });
}

// =========================
// FLOW: ANALYZE SYMPTOM
// =========================
async function analyzeSymptom() {
  const input = $("symptomInput");
  const loadingBox = $("loading-box");

  if (!input) return;

  const symptom = input.value.trim();

  if (!symptom) {
    alert("Vui lòng nhập mô tả triệu chứng.");
    return;
  }

  try {
    loadingBox?.classList.remove("hidden");

    const result = await apiPost("/predict", { symptom });

    state.symptom = result.symptom || "";
    state.predictedSpecialty = result.predicted_specialty || "";
    state.topPredictions = result.top_predictions || [];
    state.warning = result.warning || null;
    state.doctors = result.recommended_doctors || [];
    state.slotCache = {};

    $("predicted-specialty").textContent = state.predictedSpecialty || "-";
    $("submitted-symptom").textContent = state.symptom || "-";

    const warningBox = $("warning-box");
    const warningText = $("warning-text");

    if (state.warning) {
      warningText.textContent = state.warning;
      warningBox?.classList.remove("hidden");
    } else {
      warningText.textContent = "";
      warningBox?.classList.add("hidden");
    }

    renderTopPredictions(state.topPredictions);
    renderDoctors(state.doctors);

    showScreen("result-screen");
  } catch (error) {
    alert(error.message || "Không thể phân tích triệu chứng.");
  } finally {
    loadingBox?.classList.add("hidden");
  }
}

// =========================
// FLOW: BOOK APPOINTMENT
// =========================
async function confirmBooking() {
  const patientName = $("patient-name")?.value.trim() || "";
  const patientPhone = $("patient-phone")?.value.trim() || "";

  if (!patientName || !patientPhone) {
    alert("Vui lòng nhập đầy đủ họ tên và số điện thoại.");
    return;
  }

  if (!state.selectedDoctor || !state.selectedSlot) {
    alert("Vui lòng chọn bác sĩ và khung giờ trước.");
    return;
  }

  try {
    const result = await apiPost("/book-appointment", {
      patient_name: patientName,
      patient_phone: patientPhone,
      doctor_id: state.selectedDoctor.doctor_id,
      slot_id: state.selectedSlot.slot_id,
    });

    state.bookingResult = result;

    $("confirmation-appointment-id").textContent = safeText(result.appointment_id) || "-";
    $("confirmation-doctor-name").textContent =
      safeText(result.doctor_name) || safeText(formatDoctorName(state.selectedDoctor)) || "-";
    $("confirmation-department").textContent = safeText(state.selectedDoctor.department) || "-";
    $("confirmation-slot-time").textContent =
      formatSlotRange(state.selectedSlot.slot_start, state.selectedSlot.slot_end);
    $("confirmation-patient-name").textContent = patientName;
    $("confirmation-patient-phone").textContent = patientPhone;

    showScreen("confirmation-screen");
  } catch (error) {
    alert(error.message || "Đặt lịch thất bại.");
  }
}

// =========================
// FLOW: SEARCH HISTORY
// =========================
async function searchHistory() {
  const phone = $("history-phone")?.value.trim() || "";

  if (!phone) {
    alert("Vui lòng nhập số điện thoại.");
    return;
  }

  try {
    const result = await apiGet(`/appointments/by-phone?phone=${encodeURIComponent(phone)}`);
    renderHistory(result.appointments || []);
  } catch (error) {
    alert(error.message || "Không thể tra cứu lịch hẹn.");
  }
}

// =========================
// EVENT BINDING
// =========================
function bindNavigation() {
  $("start-check-btn")?.addEventListener("click", () => {
    showScreen("symptom-screen");
  });

  $("go-history-btn")?.addEventListener("click", () => {
    showScreen("history-screen");
  });

  $("go-home-from-confirmation")?.addEventListener("click", () => {
    showScreen("home-screen");
  });

  $("go-history-from-confirmation")?.addEventListener("click", () => {
    const phone = $("confirmation-patient-phone")?.textContent || "";
    if ($("history-phone")) $("history-phone").value = phone;
    showScreen("history-screen");
    searchHistory();
  });

  $("view-doctors-btn")?.addEventListener("click", () => {
    renderDoctors(state.doctors);
    showScreen("doctor-screen");
  });

  document.querySelectorAll(".back-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if (target) {
        showScreen(target);
      }
    });
  });
}

function bindActions() {
  $("analyze-btn")?.addEventListener("click", analyzeSymptom);

  $("clear-symptom-btn")?.addEventListener("click", () => {
    if ($("symptomInput")) $("symptomInput").value = "";
  });

  $("confirm-booking-btn")?.addEventListener("click", confirmBooking);

  $("search-history-btn")?.addEventListener("click", searchHistory);
}

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindActions();
  showScreen("home-screen");
});
