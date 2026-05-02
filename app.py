from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
from pathlib import Path
from datetime import datetime
import json
import joblib
import numpy as np

# =========================================================
# APP SETUP
# =========================================================
app = FastAPI(
    title="AI Medical Appointment + System Checker",
    version="3.0.0",
    description="AI-powered medical appointment booking system using JSON demo data."
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# =========================================================
# PATH CONFIG
# =========================================================
BASE_DIR = Path(".")
DATA_DIR = BASE_DIR / "data"

MODEL_PATH = BASE_DIR / "medical_specialty_model.joblib"
DEPARTMENTS_FILE = DATA_DIR / "departments.json"
DOCTORS_FILE = DATA_DIR / "doctors.json"
SLOTS_FILE = DATA_DIR / "slots.json"
APPOINTMENTS_FILE = DATA_DIR / "appointments.json"

# =========================================================
# LOAD MODEL
# =========================================================
try:
    model = joblib.load(MODEL_PATH)
except Exception as e:
    raise RuntimeError(f"Không load được model từ {MODEL_PATH}: {e}")

# =========================================================
# CONSTANTS
# =========================================================
DANGER_KEYWORDS = [
    "khó thở",
    "đau ngực",
    "ngất",
    "liệt",
    "chảy máu nhiều",
    "co giật",
    "mất ý thức",
    "đau đầu dữ dội",
    "khó nói",
    "tê nửa người"
]

# =========================================================
# REQUEST MODELS
# =========================================================
class PredictRequest(BaseModel):
    symptom: str = Field(..., min_length=2, description="Mô tả triệu chứng bằng tiếng Việt")

    @field_validator("symptom")
    @classmethod
    def validate_symptom(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Triệu chứng không được để trống.")
        return value


class AppointmentRequest(BaseModel):
    patient_name: str = Field(..., min_length=2)
    patient_phone: str = Field(..., min_length=8)
    doctor_id: int
    slot_id: int

    @field_validator("patient_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Tên bệnh nhân không hợp lệ.")
        return value

    @field_validator("patient_phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 8:
            raise ValueError("Số điện thoại không hợp lệ.")
        return value


# =========================================================
# JSON HELPERS
# =========================================================
def load_json(file_path: Path) -> List[Dict[str, Any]]:
    if not file_path.exists():
        return []

    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(file_path: Path, data: List[Dict[str, Any]]) -> None:
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# =========================================================
# MODEL HELPERS
# =========================================================
def get_model_classes() -> List[str]:
    if hasattr(model, "classes_"):
        return list(model.classes_)

    if hasattr(model, "named_steps"):
        clf = model.named_steps.get("clf")
        if clf is not None and hasattr(clf, "classes_"):
            return list(clf.classes_)

    return []


def softmax(scores):
    scores = np.array(scores, dtype=float)
    scores = scores - np.max(scores)
    exp_scores = np.exp(scores)
    return exp_scores / np.sum(exp_scores)


def get_top_predictions(text: str, top_k: int = 3) -> List[Dict[str, Any]]:
    classes = get_model_classes()

    if hasattr(model, "predict_proba") and classes:
        probs = model.predict_proba([text])[0]
        top_indices = np.argsort(probs)[::-1][:top_k]
        return [
            {
                "specialty": classes[i],
                "score": round(float(probs[i]), 4)
            }
            for i in top_indices
        ]

    if hasattr(model, "decision_function") and classes:
        scores = model.decision_function([text])

        if len(np.array(scores).shape) == 1:
            probs = softmax(scores)
        else:
            probs = softmax(scores[0])

        top_indices = np.argsort(probs)[::-1][:top_k]
        return [
            {
                "specialty": classes[i],
                "score": round(float(probs[i]), 4)
            }
            for i in top_indices
        ]

    pred = model.predict([text])[0]
    return [{"specialty": pred, "score": 1.0}]


def get_warning(symptom: str) -> Optional[str]:
    symptom_lower = symptom.lower()

    for keyword in DANGER_KEYWORDS:
        if keyword in symptom_lower:
            return "⚠ Có dấu hiệu nguy hiểm. Vui lòng đến cơ sở y tế gần nhất hoặc gọi cấp cứu."

    return None


# =========================================================
# DATA HELPERS
# =========================================================
def get_departments() -> List[Dict[str, Any]]:
    return load_json(DEPARTMENTS_FILE)


def get_doctors() -> List[Dict[str, Any]]:
    return load_json(DOCTORS_FILE)


def get_slots() -> List[Dict[str, Any]]:
    return load_json(SLOTS_FILE)


def get_appointments() -> List[Dict[str, Any]]:
    return load_json(APPOINTMENTS_FILE)


def find_doctor(doctor_id: int) -> Optional[Dict[str, Any]]:
    doctors = get_doctors()
    for doctor in doctors:
        if doctor.get("id") == doctor_id:
            return doctor
    return None


def get_doctors_by_department(department_name: str) -> List[Dict[str, Any]]:
    doctors = get_doctors()

    results = []
    for doctor in doctors:
        if doctor.get("department_name", "").strip().lower() == department_name.strip().lower():
            results.append({
                "doctor_id": doctor["id"],
                "doctor_name": doctor["full_name"],
                "department_id": doctor["department_id"],
                "department": doctor["department_name"],
                "phone": doctor.get("phone", ""),
                "email": doctor.get("email", ""),
                "title": doctor.get("title", ""),
                "experience_years": doctor.get("experience_years", 0),
                "hospital": doctor.get("hospital", ""),
                "description": doctor.get("description", ""),
                "working_time": doctor.get("working_time", ""),
                "fee": doctor.get("fee", 0),
                "rating": doctor.get("rating", 0),
                "avatar": doctor.get("avatar", "")
            })

    return results


def get_slots_by_doctor(doctor_id: int) -> List[Dict[str, Any]]:
    slots = get_slots()

    results = []
    for slot in slots:
        if slot.get("doctor_id") == doctor_id and slot.get("is_booked") is False:
            results.append({
                "slot_id": slot["id"],
                "slot_start": slot["slot_start"],
                "slot_end": slot["slot_end"]
            })

    return results


def book_appointment_to_json(
    patient_name: str,
    patient_phone: str,
    doctor_id: int,
    slot_id: int
) -> int:
    slots = get_slots()
    appointments = get_appointments()

    target_slot = None
    for slot in slots:
        if (
            slot.get("id") == slot_id
            and slot.get("doctor_id") == doctor_id
            and slot.get("is_booked") is False
        ):
            target_slot = slot
            break

    if target_slot is None:
        raise HTTPException(status_code=400, detail="Khung giờ không hợp lệ hoặc đã được đặt.")

    target_slot["is_booked"] = True
    save_json(SLOTS_FILE, slots)

    new_id = 1 if not appointments else max(item["id"] for item in appointments) + 1

    appointment = {
        "id": new_id,
        "patient_name": patient_name,
        "patient_phone": patient_phone,
        "doctor_id": doctor_id,
        "slot_id": slot_id,
        "status": "booked",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    appointments.append(appointment)
    save_json(APPOINTMENTS_FILE, appointments)

    return new_id


def get_appointments_by_phone(phone: str) -> List[Dict[str, Any]]:
    appointments = get_appointments()
    doctors = get_doctors()
    slots = get_slots()

    doctor_map = {doctor["id"]: doctor for doctor in doctors}
    slot_map = {slot["id"]: slot for slot in slots}

    results = []
    for appointment in appointments:
        if appointment.get("patient_phone", "").strip() == phone.strip():
            doctor = doctor_map.get(appointment.get("doctor_id"), {})
            slot = slot_map.get(appointment.get("slot_id"), {})

            results.append({
                "appointment_id": appointment.get("id"),
                "patient_name": appointment.get("patient_name"),
                "patient_phone": appointment.get("patient_phone"),
                "doctor_name": doctor.get("full_name", ""),
                "department": doctor.get("department_name", ""),
                "slot_start": slot.get("slot_start", ""),
                "slot_end": slot.get("slot_end", ""),
                "status": appointment.get("status", ""),
                "created_at": appointment.get("created_at", "")
            })

    return results


# =========================================================
# WEB ROUTE
# =========================================================
@app.get("/", response_class=HTMLResponse)
def homepage(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# =========================================================
# API ROUTES
# =========================================================
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/departments")
def departments():
    return {"departments": get_departments()}


@app.post("/predict")
def predict_symptom(data: PredictRequest):
    symptom = data.symptom.strip()

    try:
        prediction = model.predict([symptom])[0]
        top_predictions = get_top_predictions(symptom, top_k=3)
        warning = get_warning(symptom)
        doctors = get_doctors_by_department(prediction)

        return {
            "symptom": symptom,
            "predicted_specialty": prediction,
            "top_predictions": top_predictions,
            "warning": warning,
            "recommended_doctors": doctors
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi dự đoán AI: {e}")


@app.get("/doctors")
def doctors_by_department(department: str):
    department = department.strip()
    if not department:
        raise HTTPException(status_code=400, detail="Thiếu tên chuyên khoa.")

    doctors = get_doctors_by_department(department)
    return {
        "department": department,
        "doctors": doctors
    }


@app.get("/doctor/{doctor_id}")
def doctor_detail(doctor_id: int):
    doctor = find_doctor(doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy bác sĩ.")

    return {
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
        "department_id": doctor["department_id"],
        "department_name": doctor["department_name"],
        "phone": doctor.get("phone", ""),
        "email": doctor.get("email", ""),
        "title": doctor.get("title", ""),
        "experience_years": doctor.get("experience_years", 0),
        "hospital": doctor.get("hospital", ""),
        "description": doctor.get("description", ""),
        "working_time": doctor.get("working_time", ""),
        "fee": doctor.get("fee", 0),
        "rating": doctor.get("rating", 0),
        "avatar": doctor.get("avatar", "")
    }


@app.get("/slots/{doctor_id}")
def slots_by_doctor(doctor_id: int):
    doctor = find_doctor(doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy bác sĩ.")

    slots = get_slots_by_doctor(doctor_id)

    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor["full_name"],
        "department_name": doctor.get("department_name", ""),
        "title": doctor.get("title", ""),
        "experience_years": doctor.get("experience_years", 0),
        "hospital": doctor.get("hospital", ""),
        "description": doctor.get("description", ""),
        "working_time": doctor.get("working_time", ""),
        "fee": doctor.get("fee", 0),
        "rating": doctor.get("rating", 0),
        "avatar": doctor.get("avatar", ""),
        "slots": slots
    }


@app.post("/book-appointment")
def book_appointment(data: AppointmentRequest):
    doctor = find_doctor(data.doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="Bác sĩ không tồn tại.")

    appointment_id = book_appointment_to_json(
        patient_name=data.patient_name,
        patient_phone=data.patient_phone,
        doctor_id=data.doctor_id,
        slot_id=data.slot_id
    )

    return {
        "message": "Đặt lịch thành công.",
        "appointment_id": appointment_id,
        "patient_name": data.patient_name,
        "patient_phone": data.patient_phone,
        "doctor_id": data.doctor_id,
        "doctor_name": doctor["full_name"],
        "status": "booked"
    }


@app.get("/appointments/by-phone")
def appointments_by_phone(phone: str):
    phone = phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Thiếu số điện thoại.")

    results = get_appointments_by_phone(phone)

    return {
        "phone": phone,
        "appointments": results
    }