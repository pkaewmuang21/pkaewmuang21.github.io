# First Aid — Redesign

เว็บแอปบันทึกการรักษาห้องพยาบาล เวอร์ชันดีไซน์ใหม่ (ตาม `PG First Aid Redesign.html`)
ใช้ข้อมูล Firestore ชุดเดิมของระบบ `index.html` (collection และ field เหมือนเดิมทุกอย่าง)

- ไม่ต้อง build: HTML + CSS + JavaScript (ES modules) วางบน GitHub Pages ได้ทันที
- ไม่มีฟีเจอร์คิวรอตรวจในรอบนี้ (ทำภายหลัง)

## รันบนเครื่อง

ES modules ต้องเปิดผ่าน http (ดับเบิลคลิกเปิดไฟล์ตรงๆ ไม่ได้)

```bash
cd app
npx serve -l 5173
```

แล้วเปิด http://localhost:5173

| URL | โหมด |
|---|---|
| `/` | Firestore + Google login จริง (ค่าเริ่มต้น) |
| `/?mode=mock` | ข้อมูลจำลอง ไม่ต้อง login ข้อมูลหายเมื่อรีเฟรช — **ใช้ได้เฉพาะ localhost** บนโดเมนจริงจะถูกบังคับเป็นข้อมูลจริงเสมอ |

## โครงสร้าง

```
app/
├─ index.html
├─ css/
│  ├─ base.css          design tokens + components จากไฟล์ดีไซน์
│  └─ app.css           layout, overlay และสไตล์เฉพาะหน้า
└─ js/
   ├─ main.js           เริ่มแอป: โหลด Firebase → login → router
   ├─ config.js         firebaseConfig, โหมดข้อมูล, ค่าเกณฑ์ต่างๆ
   ├─ core/             firebase, session (login/สิทธิ์/timeout), router, ui, icons, format, codes
   ├─ data/
   │  ├─ api.js         การอ่าน/เขียน Firestore ทั้งหมดอยู่ที่นี่ที่เดียว
   │  └─ cache.js       IndexedDB cache (CN เข้า/ถอดรหัส, รายชื่อพนักงาน)
   ├─ mock/mock-firebase.js   Firebase จำลอง + ข้อมูลตัวอย่าง
   └─ views/            หน้าจอแต่ละหน้า
```

## แผนพัฒนา (Phases)

| Phase | ขอบเขต | สถานะ |
|---|---|---|
| **1. Foundation + พนักงาน** | โครงแอป (เมนู, แถบบน, router), design system, ชั้นข้อมูล Firebase/Mock, Google login + ตรวจสิทธิ์ staff + timeout, เปลี่ยน location (admin), ค้นหา CN, โปรไฟล์, timeline ประวัติ, รายละเอียดการรักษา, เพิ่ม/แก้ไขพนักงาน | ✅ เสร็จ |
| **2. บันทึกการรักษา (OPD card)** | ฟอร์มการเข้ารับบริการ, ESI, ประเภทบริการ, vital signs พร้อมเตือนค่าผิดปกติ, อาการ/ICD-10 (ค้นหาได้), รายการยา + วิธีใช้ + แนะนำตาม ICD, เตือนแพ้ยา/สต็อกไม่พอ, ตัดสต็อกเมื่อบันทึก, บันทึกร่างอัตโนมัติ | ✅ เสร็จ |
| **3. รายงาน** | ช่วงเวลา preset, location (admin), 5 รายงาน (ประเภทบริการ, แผนก, การวินิจฉัย + Disease system, การใช้ยา, รายผู้ใช้บริการ), KPI + กราฟ + ตาราง, Export Excel (ชีตข้อมูล + กราฟโดนัทแบบเดิม) | ✅ เสร็จ |
| **4. คลังยา** | KPI, ค้นหา/กรอง/เรียง, ตารางสถานะ, ประวัติเคลื่อนไหว, รับเข้า/จ่ายออก, แก้ไข/ลบยา, ตัดยาหมดอายุ | ✅ เสร็จ |
| **5. เตรียมขึ้นระบบ** | ตัดหน้า Dashboard (Looker + Sync Sheet) ออก, ค่าเริ่มต้นเป็นข้อมูลจริง, ล็อกโหมดจำลองไว้เฉพาะ localhost, workflow GitHub Actions deploy | ✅ เตรียมแล้ว — **ยังไม่ deploy** |
| **5.1 ทดสอบกับข้อมูลจริง + deploy** | ทดสอบ `?mode=firebase` บนเครื่องด้วยบัญชีจริง แล้วทำตามขั้นตอน Deploy ด้านล่าง | ⏳ รอยืนยัน |
| **Q1. คิวรอตรวจ** | collection ใหม่ `queue` + `queueCounter` (แยก location, เลขคิวรายวัน), หน้าคิว (สรุปรอตรวจ/กำลังตรวจ/ห้องสังเกต, แท็บสถานะ, เรียงตามความเร่งด่วน/เวลา — ไม่แสดงเวลารอ), เพิ่มคิว, เริ่มตรวจ, เปลี่ยน ESI, ย้ายห้องสังเกต, ยกเลิกคิว, ป้ายคิวบนแถบด้านบน, คีย์ลัด ↑↓ Enter T N | ✅ เสร็จ |
| **Q2** | เชื่อมกับบันทึกการรักษา (กรอกจากคิว + บันทึกและปิดคิว + ส่งต่อ + ย้ายห้องสังเกต, `opdCard.queueId`), เชื่อมหน้าค้นหาพนักงาน/ฟอร์มเพิ่มพนักงาน, มุมมอง Kanban | ✅ เสร็จ |
| **Q3** | จัดการคิวค้างข้ามวัน, ข้อความ error เมื่อติด Firestore rules, เอกสาร rules/index + checklist ทดสอบข้อมูลจริง | ✅ เสร็จ (รอทดสอบกับข้อมูลจริงตาม checklist) |

## Firestore สำหรับคิวรอตรวจ

### Collection ใหม่

| Collection | Document | ใช้ทำอะไร |
|---|---|---|
| `queue` | 1 คิว | `date`, `location`, `no`, `employeeDocId`, `chiefComplaint`, `esi`, `esiHistory`, `status` (waiting / in_progress / observe / done / referred / cancelled), `arrivedAt`, `startedAt`, `observeAt`, `closedAt`, `assignedTo`, `closedBy`, `cancelReason`, `opdCardId`, `createdBy`, `createdAt`, `updatedAt` |
| `queueCounter` | `{location}_{YYYY-MM-DD}` | `last` = เลขคิวล่าสุดของวัน (เพิ่มด้วย transaction) |

field ที่เพิ่มใน collection เดิม: `employees/{id}/opdCard.queueId` (optional — มีเฉพาะการรักษาที่มาจากคิว)

### Security Rules

ถ้า rules ปัจจุบันเขียนแยกราย collection ต้องเพิ่ม 2 collection นี้ (ใช้เงื่อนไขเดียวกับที่ใช้กับ `employees`) — ตัวอย่างถ้าเงื่อนไขเดิมคือ “login แล้ว”:

```
match /queue/{id}        { allow read, write: if request.auth != null; }
match /queueCounter/{id} { allow read, write: if request.auth != null; }
```

ถ้า rules ปัจจุบันเป็นแบบครอบทุก collection (`match /{document=**}`) ไม่ต้องแก้

### Index

query ที่ใช้มีแค่เงื่อนไขเท่ากับ / `in` → **ไม่ต้องสร้าง composite index**
- คิววันนี้: `location ==` + `date ==` (ฟังแบบ real-time)
- คิวค้าง: `location ==` + `status in [waiting, in_progress, observe]`

ถ้า Firestore แจ้งให้สร้าง index (error `failed-precondition`) ใน console ของเบราว์เซอร์จะมีลิงก์สร้าง index ให้กดได้ทันที

## Checklist ทดสอบกับข้อมูลจริง (ก่อน deploy)

เปิด http://localhost:5173 (โหมดข้อมูลจริง) แล้ว login ด้วยบัญชี staff — แนะนำใช้พนักงานทดสอบ 1 คน

1. **Login / สิทธิ์** — ชื่อ + location ถูกต้อง, admin เปลี่ยน location ได้
2. **ค้นหาพนักงาน** — Enter แสดงทั้งหมด, CN ถอดรหัสถูก, ประวัติการรักษาตรงกับระบบเดิม
3. **คิว** — เพิ่มคิว (ได้เลข #1 ของวัน), เปิดอีกเครื่อง/อีกแท็บเห็นคิวทันที, เปลี่ยน ESI, ย้ายห้องสังเกต, ยกเลิก
   - ถ้าขึ้น “ไม่มีสิทธิ์เข้าถึงข้อมูลนี้” → เพิ่ม rules ด้านบน
4. **เริ่มตรวจ → บันทึกและปิดคิว** — ข้อมูลจากคิวถูกกรอก, บันทึกแล้วคิวเป็น “เสร็จสิ้น”, เปิดระบบเดิมเห็นการรักษาครั้งนี้ปกติ, สต็อกยาถูกตัด
5. **รายงาน** — ตัวเลขตรงกับรายงานระบบเดิมในช่วงเดียวกัน, Export Excel เปิดได้
6. **คลังยา** — รับเข้า/จ่ายออก, ประวัติเคลื่อนไหว
7. **คิวค้างข้ามวัน** — วันถัดไปหน้าคิวต้องแจ้ง “มีคิวค้างจากวันก่อน” ถ้ามีคิวที่ไม่ได้ปิด

## Deploy บน GitHub Pages (ยังไม่ได้ทำ)

ไฟล์ workflow อยู่ที่ `.github/workflows/deploy-pages.yml` — deploy เฉพาะโฟลเดอร์ `app/` เมื่อ push เข้า branch `main`

1. ทดสอบบนเครื่องกับข้อมูลจริงก่อน: เปิด http://localhost:5173 แล้ว login ด้วยบัญชี staff
2. สร้าง repo บน GitHub แล้ว push โฟลเดอร์โปรเจกต์นี้ขึ้น branch `main`
   - ระวัง: `index.html` (ระบบเดิม) และ `index-mock.html` จะถูก push ขึ้นไปด้วยถ้าอยู่ในโฟลเดอร์เดียวกัน แม้ workflow จะ deploy แค่ `app/` — ถ้า repo เป็น public ควรแยกออกหรือใส่ `.gitignore`
3. GitHub → Settings → Pages → Build and deployment → Source: **GitHub Actions**
4. Firebase Console → Authentication → Settings → Authorized domains → เพิ่ม `<user>.github.io` (ไม่งั้น Google login จะขึ้น error `auth/unauthorized-domain`)
5. เปิด `https://<user>.github.io/<repo>/` แล้วทดสอบ login, ค้นหาพนักงาน, บันทึกการรักษา, รายงาน, คลังยา

หมายเหตุ: GitHub Pages cache ไฟล์ประมาณ 10 นาที หลัง deploy ผู้ใช้อาจต้องรีเฟรช (Ctrl+F5) ถึงจะเห็นเวอร์ชันใหม่
