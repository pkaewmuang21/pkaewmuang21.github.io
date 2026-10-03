/* =====================================================================
 * MOCK FIREBASE (สำหรับ Re-design เท่านั้น)
 * - แทนที่ firebase-app / auth / firestore / functions ด้วยข้อมูลจำลองในหน่วยความจำ
 * - ไม่มีการเชื่อมต่อฐานข้อมูลหรือ login จริง
 * - ข้อมูลที่บันทึก/แก้ไขจะหายเมื่อรีเฟรชหน้า
 * ===================================================================== */
(function () {
    const NETWORK_DELAY = 120; // ms จำลองความหน่วงของ network

    // ---------- Timestamp / FieldValue ----------
    class Timestamp {
        constructor(ms) { this._ms = ms; }
        toDate() { return new Date(this._ms); }
        toMillis() { return this._ms; }
        get seconds() { return Math.floor(this._ms / 1000); }
        get nanoseconds() { return (this._ms % 1000) * 1e6; }
        static fromDate(d) { return new Timestamp(d.getTime()); }
        static now() { return new Timestamp(Date.now()); }
    }
    const SERVER_TS = { __mockServerTimestamp: true };

    function clone(v) {
        if (v instanceof Timestamp) return new Timestamp(v._ms);
        if (Array.isArray(v)) return v.map(clone);
        if (v && typeof v === 'object') {
            const o = {};
            for (const k in v) o[k] = clone(v[k]);
            return o;
        }
        return v;
    }
    function resolveWrite(data) {
        const o = {};
        for (const k in data) o[k] = data[k] === SERVER_TS ? Timestamp.now() : clone(data[k]);
        return o;
    }
    const delay = (v) => new Promise(r => setTimeout(() => r(v), NETWORK_DELAY));
    const autoId = () => Array.from({ length: 20 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

    // ---------- In-memory store: "col/doc/sub/doc" -> data ----------
    const store = new Map();
    const parentPath = (p) => p.split('/').slice(0, -1).join('/');

    function cmp(a, b) {
        if (a instanceof Timestamp) a = a._ms;
        if (b instanceof Timestamp) b = b._ms;
        if (a === b) return 0;
        if (a === undefined || a === null) return -1;
        if (b === undefined || b === null) return 1;
        return a < b ? -1 : 1;
    }
    function matches(val, op, target) {
        switch (op) {
            case '==': return cmp(val, target) === 0;
            case '!=': return cmp(val, target) !== 0;
            case '>=': return val !== undefined && cmp(val, target) >= 0;
            case '<=': return val !== undefined && cmp(val, target) <= 0;
            case '>': return val !== undefined && cmp(val, target) > 0;
            case '<': return val !== undefined && cmp(val, target) < 0;
            case 'in': return target.some(t => cmp(val, t) === 0);
            case 'array-contains': return Array.isArray(val) && val.some(t => cmp(t, target) === 0);
            default: throw new Error('Mock Firestore: unsupported operator ' + op);
        }
    }

    // ---------- real-time listeners (onSnapshot) ----------
    const listeners = new Set();
    let notifyTimer;
    function changed() {
        clearTimeout(notifyTimer);
        notifyTimer = setTimeout(() => listeners.forEach((l) => { try { l.run(); } catch (e) { console.error(e); } }), 30);
    }
    function listen(run) {
        const l = { run };
        listeners.add(l);
        setTimeout(() => listeners.has(l) && run(), NETWORK_DELAY);
        return () => listeners.delete(l);
    }
    // ---------- writers (sync) ----------
    function writeSet(path, data, opts) {
        const base = opts && opts.merge ? (store.get(path) || {}) : {};
        store.set(path, { ...base, ...resolveWrite(data) });
        changed();
    }
    function writeUpdate(path, data) {
        if (!store.has(path)) throw new Error('Mock Firestore: No document to update: ' + path);
        store.set(path, { ...store.get(path), ...resolveWrite(data) });
        changed();
    }
    function writeDelete(path) {
        for (const p of [...store.keys()]) if (p === path || p.startsWith(path + '/')) store.delete(p);
        changed();
    }

    class DocumentSnapshot {
        constructor(path) {
            this.ref = new DocumentReference(path);
            this.id = this.ref.id;
            this._data = store.get(path);
            this.exists = this._data !== undefined;
        }
        data() { return this.exists ? clone(this._data) : undefined; }
        get(field) { return this.exists ? clone(this._data[field]) : undefined; }
    }
    class QuerySnapshot {
        constructor(paths) {
            this.docs = paths.map(p => new DocumentSnapshot(p));
            this.size = this.docs.length;
            this.empty = this.size === 0;
        }
        forEach(fn) { this.docs.forEach(fn); }
    }

    class Query {
        constructor(spec) { this._spec = spec; }
        _with(patch) { return new Query({ ...this._spec, ...patch }); }
        where(field, op, value) { return this._with({ filters: [...this._spec.filters, [field, op, value]] }); }
        orderBy(field, dir = 'asc') { return this._with({ orders: [...this._spec.orders, [field, dir]] }); }
        limit(n) { return this._with({ limit: n }); }
        _paths() {
            const { colPath, group, filters, orders, limit } = this._spec;
            let paths = [...store.keys()].filter(p => {
                const parent = parentPath(p);
                return group ? parent.split('/').pop() === group && parent.split('/').length % 2 === 1
                             : parent === colPath;
            });
            paths = paths.filter(p => filters.every(([f, op, v]) => matches(store.get(p)[f], op, v)));
            if (orders.length) {
                paths.sort((a, b) => {
                    for (const [f, dir] of orders) {
                        const c = cmp(store.get(a)[f], store.get(b)[f]);
                        if (c) return dir === 'desc' ? -c : c;
                    }
                    return 0;
                });
            }
            return limit ? paths.slice(0, limit) : paths;
        }
        get() { return delay(new QuerySnapshot(this._paths())); }
        onSnapshot(next) { return listen(() => next(new QuerySnapshot(this._paths()))); }
    }

    class CollectionReference extends Query {
        constructor(path) {
            super({ colPath: path, filters: [], orders: [] });
            this.path = path;
            this.id = path.split('/').pop();
            const pp = parentPath(path);
            this.parent = pp ? new DocumentReference(pp) : null;
        }
        doc(id) { return new DocumentReference(this.path + '/' + (id || autoId())); }
        add(data) {
            const ref = this.doc();
            writeSet(ref.path, data);
            return delay(ref);
        }
    }

    class DocumentReference {
        constructor(path) {
            this.path = path;
            this.id = path.split('/').pop();
            this.parent = new CollectionReference(parentPath(path));
        }
        collection(name) { return new CollectionReference(this.path + '/' + name); }
        get() { return delay(new DocumentSnapshot(this.path)); }
        set(data, opts) { writeSet(this.path, data, opts); return delay(); }
        update(data) {
            try { writeUpdate(this.path, data); } catch (e) { return Promise.reject(e); }
            return delay();
        }
        delete() { writeDelete(this.path); return delay(); }
        onSnapshot(next) { return listen(() => next(new DocumentSnapshot(this.path))); }
    }

    const firestoreInstance = {
        collection: (path) => new CollectionReference(path),
        collectionGroup: (name) => new Query({ group: name, filters: [], orders: [] }),
        doc: (path) => new DocumentReference(path),
        batch() {
            const ops = [];
            return {
                set: (ref, d, o) => ops.push(() => ref.set(d, o)),
                update: (ref, d) => ops.push(() => ref.update(d)),
                delete: (ref) => ops.push(() => ref.delete()),
                commit: () => Promise.all(ops.map(op => op()))
            };
        },
        async runTransaction(fn) {
            const tx = {
                get: async (ref) => new DocumentSnapshot(ref.path),
                set: (ref, d, o) => { writeSet(ref.path, d, o); return tx; },
                update: (ref, d) => { writeUpdate(ref.path, d); return tx; },
                delete: (ref) => { writeDelete(ref.path); return tx; },
            };
            const r = await fn(tx);
            return delay(r);
        },
        _store: store
    };

    // ---------- Mock "encryption" (Cloud Functions encryptText / decryptText) ----------
    const ENC_PREFIX = 'mock:';
    const encrypt = (t) => ENC_PREFIX + btoa(unescape(encodeURIComponent(String(t))));
    const decrypt = (e) => {
        if (typeof e !== 'string' || !e.startsWith(ENC_PREFIX)) return e;
        try { return decodeURIComponent(escape(atob(e.slice(ENC_PREFIX.length)))); } catch { return e; }
    };
    const functionsInstance = {
        httpsCallable(name) {
            return async (payload) => {
                await delay();
                if (name === 'encryptText') return { data: { encrypted: encrypt(payload.text) } };
                if (name === 'decryptText') return { data: { decrypted: decrypt(payload.encrypted) } };
                throw new Error('Mock Functions: unknown function ' + name);
            };
        }
    };

    // ---------- Mock Auth (เข้าระบบอัตโนมัติ) ----------
    const MOCK_USER = {
        uid: 'mock-user-001',
        email: 'nurse.demo@example.com',
        displayName: 'พยาบาล ทดสอบ',
        getIdTokenResult: async () => ({ authTime: new Date().toUTCString(), claims: {} }),
        getIdToken: async () => 'mock-token'
    };
    const authInstance = {
        currentUser: MOCK_USER,
        onAuthStateChanged(cb) { setTimeout(() => cb(MOCK_USER), 0); return () => { }; },
        signInWithPopup: async () => ({ user: MOCK_USER }),
        signInWithRedirect: async () => { },
        signInWithEmailAndPassword: async () => ({ user: MOCK_USER }),
        signOut: async () => { console.info('[mock] signOut ถูกปิดไว้ในโหมด mock'); }
    };

    // ---------- firebase global ----------
    const auth = () => authInstance;
    auth.GoogleAuthProvider = class { };
    const firestore = () => firestoreInstance;
    firestore.Timestamp = Timestamp;
    firestore.FieldValue = {
        serverTimestamp: () => SERVER_TS,
        delete: () => undefined,
        increment: (n) => n
    };
    window.firebase = {
        initializeApp: () => ({}),
        auth,
        firestore,
        functions: () => functionsInstance
    };

    // =================================================================
    // MOCK DATA
    // =================================================================
    let seed = 20261003;
    const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const ymdhm = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const daysFromToday = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
    const put = (path, data) => store.set(path, data);

    // ----- location -----
    const LOCATIONS = ['สำนักงานใหญ่', 'โรงงานระยอง', 'คลังสินค้าบางนา'];
    LOCATIONS.forEach((name, i) => put(`location/loc${i + 1}`, { name }));

    // ----- staff (ผู้ใช้ที่ login อยู่) -----
    put('staff/staff001', { email: MOCK_USER.email, name: MOCK_USER.displayName, location: LOCATIONS[0], isAdmin: true });
    put('staff/staff002', { email: 'nurse2.demo@example.com', name: 'พยาบาล สมใจ', location: LOCATIONS[1], isAdmin: false });

    // ----- ICD10 -----
    const ICD10 = [
        ['R51', 'Headache', 'Nervous System'],
        ['R42', 'Dizziness and giddiness', 'Nervous System'],
        ['G43.9', 'Migraine, unspecified', 'Nervous System'],
        ['J00', 'Acute nasopharyngitis (Common cold)', 'Respiratory System'],
        ['J02.9', 'Acute pharyngitis', 'Respiratory System'],
        ['R05', 'Cough', 'Respiratory System'],
        ['J45.9', 'Asthma, unspecified', 'Respiratory System'],
        ['K30', 'Dyspepsia', 'Digestive System'],
        ['K29.7', 'Gastritis, unspecified', 'Digestive System'],
        ['A09', 'Diarrhoea and gastroenteritis', 'Digestive System'],
        ['N94.6', 'Dysmenorrhoea', 'Genitourinary System'],
        ['M54.5', 'Low back pain', 'Musculoskeletal System'],
        ['M79.1', 'Myalgia', 'Musculoskeletal System'],
        ['S93.4', 'Sprain of ankle', 'Injury'],
        ['T14.0', 'Superficial injury (Abrasion)', 'Injury'],
        ['T14.1', 'Open wound', 'Injury'],
        ['T30.0', 'Burn, unspecified', 'Injury'],
        ['H10.9', 'Conjunctivitis, unspecified', 'Eye'],
        ['L50.9', 'Urticaria, unspecified', 'Skin'],
        ['T78.4', 'Allergy, unspecified', 'Immune System'],
        ['R50.9', 'Fever, unspecified', 'General Symptoms'],
        ['I10', 'Essential hypertension', 'Circulatory System'],
        ['E16.2', 'Hypoglycaemia, unspecified', 'Endocrine System']
    ];
    ICD10.forEach(([code, short_description, disease_system]) =>
        put(`ICD10/${code.replace('.', '_')}`, { code, short_description, disease_system }));

    // ----- medical_icd10_mapping (ICD10 -> ประเภทยาที่แนะนำ) -----
    const MAPPING = {
        'Analgesic / Anti-Inflamatory': ['R51', 'M54.5', 'M79.1', 'N94.6', 'R50.9', 'G43.9'],
        'Antihistamine / Decongestant': ['J00', 'L50.9', 'T78.4'],
        'Cough Medications': ['R05', 'J02.9'],
        'GI Medications': ['K30', 'K29.7', 'A09'],
        'Neuro Medications': ['R42'],
        'Medications for External Use': ['S93.4', 'T14.0', 'T14.1', 'T30.0'],
        'Eye Medications': ['H10.9'],
        'Emergency Medications': ['J45.9', 'E16.2']
    };
    Object.entries(MAPPING).forEach(([category, icd_10], i) =>
        put(`medical_icd10_mapping/map${i + 1}`, { category, icd_10 }));

    // ----- medicine -----
    // [name, type, unit, qty, expiryInDays, usage[]]
    const MEDICINES = [
        ['Paracetamol 500 mg', 'Analgesic / Anti-Inflamatory', 'เม็ด', 420, 540, ['รับประทานครั้งละ 1-2 เม็ด ทุก 4-6 ชั่วโมง เวลาปวดหรือมีไข้', 'ไม่ควรเกิน 8 เม็ดต่อวัน']],
        ['Ibuprofen 400 mg', 'Analgesic / Anti-Inflamatory', 'เม็ด', 180, 410, ['รับประทานครั้งละ 1 เม็ด หลังอาหารทันที วันละ 3 ครั้ง']],
        ['Diclofenac 25 mg', 'Analgesic / Anti-Inflamatory', 'เม็ด', 18, 300, ['รับประทานครั้งละ 1 เม็ด หลังอาหาร เช้า-เย็น']],
        ['Mefenamic acid 250 mg', 'Analgesic / Anti-Inflamatory', 'แคปซูล', 96, 60, ['รับประทานครั้งละ 2 แคปซูล หลังอาหารทันที วันละ 3 ครั้ง']],
        ['Naproxen 250 mg', 'Analgesic / Anti-Inflamatory', 'เม็ด', 75, 620, ['รับประทานครั้งละ 1 เม็ด หลังอาหาร วันละ 2 ครั้ง']],
        ['Chlorpheniramine 4 mg', 'Antihistamine / Decongestant', 'เม็ด', 350, 480, ['รับประทานครั้งละ 1 เม็ด วันละ 3 ครั้ง (อาจทำให้ง่วง)']],
        ['Loratadine 10 mg', 'Antihistamine / Decongestant', 'เม็ด', 140, 700, ['รับประทานครั้งละ 1 เม็ด วันละ 1 ครั้ง']],
        ['Cetirizine 10 mg', 'Antihistamine / Decongestant', 'เม็ด', 0, 365, ['รับประทานครั้งละ 1 เม็ด ก่อนนอน']],
        ['Pseudoephedrine 60 mg', 'Antihistamine / Decongestant', 'เม็ด', 60, 250, ['รับประทานครั้งละ 1 เม็ด วันละ 3 ครั้ง']],
        ['Bromhexine 8 mg', 'Cough Medications', 'เม็ด', 210, 390, ['รับประทานครั้งละ 1 เม็ด วันละ 3 ครั้ง หลังอาหาร']],
        ['Dextromethorphan 15 mg', 'Cough Medications', 'เม็ด', 22, 45, ['รับประทานครั้งละ 1 เม็ด วันละ 3 ครั้ง']],
        ['Ammonium Carbonate Mixture', 'Cough Medications', 'ขวด', 34, 200, ['รับประทานครั้งละ 1 ช้อนโต๊ะ วันละ 3 ครั้ง']],
        ['Strepsils', 'Cough Medications', 'เม็ด', 120, 560, ['อมครั้งละ 1 เม็ด ทุก 2-3 ชั่วโมง']],
        ['Antacid Suspension', 'GI Medications', 'ขวด', 40, 330, ['รับประทานครั้งละ 1-2 ช้อนโต๊ะ หลังอาหารและก่อนนอน']],
        ['Omeprazole 20 mg', 'GI Medications', 'แคปซูล', 160, 600, ['รับประทานครั้งละ 1 แคปซูล ก่อนอาหารเช้า 30 นาที']],
        ['Domperidone 10 mg', 'GI Medications', 'เม็ด', 130, 450, ['รับประทานครั้งละ 1 เม็ด ก่อนอาหาร 15-30 นาที']],
        ['ORS (ผงเกลือแร่)', 'GI Medications', 'ซอง', 85, 720, ['ละลายน้ำสะอาด 1 แก้ว (250 ml) จิบบ่อยๆ']],
        ['Simethicone 80 mg', 'GI Medications', 'เม็ด', 12, 280, ['เคี้ยวครั้งละ 1 เม็ด หลังอาหาร']],
        ['Loperamide 2 mg', 'GI Medications', 'แคปซูล', 48, -10, ['รับประทาน 2 แคปซูลทันที แล้ว 1 แคปซูลหลังถ่ายเหลวแต่ละครั้ง']],
        ['Dimenhydrinate 50 mg', 'Neuro Medications', 'เม็ด', 90, 380, ['รับประทานครั้งละ 1 เม็ด เวลาเวียนศีรษะ (อาจทำให้ง่วง)']],
        ['Betahistine 6 mg', 'Neuro Medications', 'เม็ด', 64, 510, ['รับประทานครั้งละ 1 เม็ด วันละ 3 ครั้ง หลังอาหาร']],
        ['Povidone-iodine 10%', 'Medications for External Use', 'ขวด', 26, 640, ['ทาแผลวันละ 1-2 ครั้ง']],
        ['Counterpain Cream', 'Medications for External Use', 'หลอด', 15, 70, ['ทาบริเวณที่ปวด วันละ 2-3 ครั้ง']],
        ['Calamine Lotion', 'Medications for External Use', 'ขวด', 30, 420, ['ทาบริเวณที่คัน วันละ 3-4 ครั้ง']],
        ['Elastic Bandage 3"', 'Medications for External Use', 'ม้วน', 44, 900, []],
        ['Alcohol 70%', 'Medications for External Use', 'ขวด', 52, 800, ['ใช้ทำความสะอาดผิวหนังรอบแผล']],
        ['Artificial Tears', 'Eye Medications', 'ขวด', 38, 260, ['หยอดตาครั้งละ 1-2 หยด เมื่อมีอาการ']],
        ['Chloramphenicol Eye Drop', 'Eye Medications', 'ขวด', 20, 120, ['หยอดตาครั้งละ 1-2 หยด ทุก 4 ชั่วโมง']],
        ['Ammonia Inhalant', 'Emergency Medications', 'หลอด', 60, 340, ['สูดดมเมื่อมีอาการหน้ามืด']],
        ['Salbutamol Inhaler', 'Emergency Medications', 'หลอด', 8, 230, ['พ่นครั้งละ 1-2 puff เมื่อมีอาการหอบ']]
    ];
    const medByName = {};
    MEDICINES.forEach(([name, type, unit, qty, exp, usage], i) => {
        const id = 'med' + String(i + 1).padStart(3, '0');
        const data = { name, type, unit, qty, expiry: ymd(daysFromToday(exp)), usage, updateDate: Timestamp.fromDate(daysFromToday(-randInt(1, 20))), createdBy: MOCK_USER.displayName };
        put(`medicine/${id}`, data);
        medByName[name] = data;
        // ประวัติการรับยาเข้าคลัง / จ่ายออก
        const txCount = randInt(1, 3);
        for (let t = 0; t < txCount; t++) {
            put(`medicine/${id}/transactions/tx${t + 1}`, {
                createdBy: MOCK_USER.displayName,
                createDate: Timestamp.fromDate(daysFromToday(-randInt(5, 120))),
                qty: pick([50, 100, 100, 200]),
                type: 'receive',
                subType: 'Receive'
            });
        }
        if (rand() < 0.25) {
            put(`medicine/${id}/transactions/tx9`, {
                createdBy: MOCK_USER.displayName,
                createDate: Timestamp.fromDate(daysFromToday(-randInt(1, 60))),
                qty: randInt(5, 20),
                type: 'dispense',
                subType: pick(['Expire', 'Distribute to Other site', 'Internal Supplies Requisition'])
            });
        }
    });

    // ----- employees -----
    const DEPARTMENTS = ['P', 'N', 'Office', 'QA', 'Warehouse', 'Maintenance'];
    const DISEASES = ['ไม่มี', 'ไม่มี', 'ไม่มี', 'ไม่มี', 'ความดันโลหิตสูง', 'เบาหวาน', 'หอบหืด', 'ไมเกรน', 'ไขมันในเลือดสูง'];
    const ALLERGIES = ['ไม่มี', 'ไม่มี', 'ไม่มี', 'ไม่มี', '-', 'แพ้ยา Penicillin', 'แพ้ยา Ibuprofen', 'แพ้อาหารทะเล', 'แพ้ยาซัลฟา'];
    const employees = [];
    for (let i = 0; i < 28; i++) {
        const id = 'emp' + String(i + 1).padStart(3, '0');
        const cn = String(640100 + i * 37 + randInt(0, 9));
        const bd = new Date(randInt(1970, 2002), randInt(0, 11), randInt(1, 28));
        put(`employees/${id}`, {
            employeeId: encrypt(cn),
            department: pick(DEPARTMENTS),
            birthdate: ymd(bd),
            phone: '08' + randInt(10000000, 99999999),
            congenitalDisease: pick(DISEASES),
            allergies: pick(ALLERGIES),
            createdDate: Timestamp.fromDate(daysFromToday(-randInt(100, 400))),
            createdBy: MOCK_USER.displayName
        });
        employees.push(id);
    }

    // ----- opdCard (ประวัติการรักษา) -----
    const ESI = [
        '1 Life threatening - รักษาทันที',
        '2 Emergent - รักษาภายใน 10-15 นาที ',
        '3 Urgent - รักษาภายใน 15-30 นาที',
        '4 SemiUrgent - รักษาภายใน 30-60 นาที',
        '5 Non Urgent - รักษาภายใน 1-2 ชั่วโมง'
    ];
    const SERVICE = {
        consult: 'ปรึกษาพยาบาล',
        self: 'สั่งจ่ายยาด้วยตนเอง',
        observe: 'ใช้ห้องสังเกตอาการ',
        emergency: 'อุบัติเหตุ/ฉุกเฉิน',
        refer: 'ส่งต่อ/แนะนำ'
    };
    const diag = (code) => ICD10.find(x => x[0] === code)[1];
    // [icd, chiefComplaint, PI&PE, advice, service, esiIndex, medicines[[name, qty, note]], weight]
    const SCENARIOS = [
        ['R51', 'ปวดศีรษะตั้งแต่เช้า', 'ปวดตื้อบริเวณขมับทั้งสองข้าง ไม่มีคลื่นไส้ อาเจียน', 'พักผ่อนให้เพียงพอ ดื่มน้ำมากๆ', 'self', 4, [['Paracetamol 500 mg', 4, '']], 6],
        ['J00', 'มีน้ำมูก คัดจมูก 2 วัน', 'คอแดงเล็กน้อย ไม่มีไข้', 'ดื่มน้ำอุ่น สวมหน้ากากอนามัย', 'self', 4, [['Chlorpheniramine 4 mg', 6, ''], ['Paracetamol 500 mg', 6, '']], 6],
        ['J02.9', 'เจ็บคอ กลืนลำบาก', 'คอแดง ต่อมทอนซิลไม่โต T 37.6', 'กลั้วคอด้วยน้ำเกลือ งดน้ำเย็น', 'self', 4, [['Strepsils', 8, ''], ['Paracetamol 500 mg', 6, '']], 4],
        ['R05', 'ไอมีเสมหะ 3 วัน', 'ปอดปกติ ไม่มีหอบเหนื่อย', 'ดื่มน้ำอุ่นมากๆ หากไอเกิน 2 สัปดาห์ให้พบแพทย์', 'self', 4, [['Bromhexine 8 mg', 9, ''], ['Ammonium Carbonate Mixture', 1, '']], 4],
        ['K30', 'แน่นท้อง จุกเสียดหลังอาหาร', 'ท้องอืดเล็กน้อย กดไม่เจ็บ', 'รับประทานอาหารให้ตรงเวลา งดอาหารรสจัด', 'self', 4, [['Antacid Suspension', 1, ''], ['Simethicone 80 mg', 6, '']], 4],
        ['A09', 'ถ่ายเหลว 4 ครั้งตั้งแต่เมื่อคืน', 'ไม่มีไข้ ไม่มีมูกเลือด ไม่มีภาวะขาดน้ำ', 'ดื่มเกลือแร่ งดอาหารรสจัดและนม', 'self', 3, [['ORS (ผงเกลือแร่)', 4, ''], ['Domperidone 10 mg', 6, '']], 3],
        ['N94.6', 'ปวดท้องประจำเดือน', 'ปวดบีบบริเวณท้องน้อย', 'ประคบอุ่นบริเวณท้องน้อย', 'self', 4, [['Mefenamic acid 250 mg', 6, '']], 3],
        ['M54.5', 'ปวดหลังส่วนล่างหลังยกของ', 'กดเจ็บกล้ามเนื้อหลังส่วนล่าง SLR negative', 'หลีกเลี่ยงการยกของหนัก ประคบอุ่น', 'self', 4, [['Ibuprofen 400 mg', 6, ''], ['Counterpain Cream', 1, '']], 4],
        ['M79.1', 'ปวดเมื่อยกล้ามเนื้อไหล่', 'กดเจ็บกล้ามเนื้อบ่า', 'ยืดเหยียดกล้ามเนื้อระหว่างทำงาน', 'consult', 5, [['Counterpain Cream', 1, '']], 3],
        ['S93.4', 'ข้อเท้าพลิกขณะเดินลงบันได', 'ข้อเท้าซ้ายบวมเล็กน้อย เดินลงน้ำหนักได้', 'ประคบเย็น 24-48 ชม. ยกขาสูง', 'emergency', 3, [['Elastic Bandage 3"', 1, ''], ['Paracetamol 500 mg', 6, '']], 2],
        ['T14.0', 'แผลถลอกที่แขนจากการทำงาน', 'แผลถลอกขนาด 2x3 cm ไม่มีสิ่งแปลกปลอม', 'ระวังแผลโดนน้ำ ทำแผลวันละ 1 ครั้ง', 'emergency', 4, [['Povidone-iodine 10%', 1, ''], ['Alcohol 70%', 1, '']], 3],
        ['T14.1', 'ถูกของมีคมบาดนิ้วมือ', 'แผลยาว 1 cm ขอบเรียบ เลือดหยุดแล้ว', 'ทำแผลทุกวัน หากบวมแดงให้กลับมาพบพยาบาล', 'emergency', 3, [['Povidone-iodine 10%', 1, '']], 2],
        ['R42', 'เวียนศีรษะ บ้านหมุน', 'BP ปกติ ไม่มีอาการอ่อนแรง', 'นอนพักในห้องสังเกตอาการ 30 นาที', 'observe', 3, [['Dimenhydrinate 50 mg', 2, '']], 2],
        ['E16.2', 'ใจสั่น เหงื่อออก หน้ามืด', 'DTX 62 mg/dL หลังให้น้ำหวาน DTX 98 mg/dL', 'รับประทานอาหารให้ตรงเวลา', 'observe', 2, [['Ammonia Inhalant', 1, '']], 1],
        ['H10.9', 'ตาแดง เคืองตา', 'Conjunctiva injected ไม่มีขี้ตามาก', 'งดขยี้ตา ล้างมือบ่อยๆ', 'self', 4, [['Chloramphenicol Eye Drop', 1, '']], 2],
        ['L50.9', 'ผื่นคันตามตัว', 'ผื่นนูนแดงบริเวณแขน ไม่มีหายใจลำบาก', 'หลีกเลี่ยงสิ่งกระตุ้น', 'self', 4, [['Loratadine 10 mg', 5, ''], ['Calamine Lotion', 1, '']], 2],
        ['I10', 'ขอวัดความดัน ปวดตึงต้นคอ', 'BP 152/96 ซ้ำ 148/94', 'ลดอาหารเค็ม แนะนำพบแพทย์เพื่อติดตามความดัน', 'refer', 3, [], 2],
        ['J45.9', 'หายใจมีเสียงวี้ด เหนื่อย', 'Wheezing both lungs SpO2 94%', 'ส่งต่อโรงพยาบาลเพื่อพ่นยา', 'refer', 2, [['Salbutamol Inhaler', 1, '']], 1],
        ['G43.9', 'ปวดศีรษะข้างเดียว ตาพร่า', 'ไม่มีอาการทางระบบประสาทอื่น', 'พักในที่มืดและเงียบ', 'observe', 3, [['Naproxen 250 mg', 4, '']], 1],
        ['R50.9', 'มีไข้ ครั่นเนื้อครั่นตัว', 'T 38.2 คอไม่แดง', 'เช็ดตัวลดไข้ ดื่มน้ำมากๆ', 'consult', 4, [['Paracetamol 500 mg', 10, '']], 3]
    ];
    const weighted = SCENARIOS.flatMap(s => Array(s[7]).fill(s));
    const vitals = (esiIdx, cc) => ({
        temperature: (cc.includes('ไข้') ? 37.8 + rand() * 0.8 : 36.3 + rand() * 0.8).toFixed(1),
        pulse: String(randInt(68, esiIdx <= 2 ? 118 : 96)),
        respiration: String(randInt(16, esiIdx <= 2 ? 26 : 20)),
        bloodPressure: `${randInt(105, 140)}/${randInt(65, 90)}`,
        oxygenSaturation: String(esiIdx <= 2 ? randInt(93, 97) : randInt(97, 100)),
        painScore: String(randInt(0, 7))
    });
    const NURSES = [MOCK_USER.displayName, 'พยาบาล สมใจ', 'พยาบาล วิภา'];

    let opdNo = 0;
    const addVisit = (empId, daysAgo) => {
        const [icd, cc, pe, advice, svc, esiIdx, meds] = pick(weighted);
        const d = daysFromToday(-daysAgo);
        d.setHours(randInt(8, 17), randInt(0, 59));
        if (d > new Date()) d.setTime(Date.now() - randInt(10, 120) * 60000);
        const created = new Date(d.getTime() + randInt(5, 25) * 60000);
        const location = rand() < 0.7 ? LOCATIONS[0] : pick(LOCATIONS.slice(1));
        put(`employees/${empId}/opdCard/opd${String(++opdNo).padStart(4, '0')}`, {
            visitDate: ymdhm(d),
            esiTriage: ESI[esiIdx - 1],
            ...vitals(esiIdx, cc),
            chiefComplaint: cc,
            physicalExamination: pe,
            diagnosis: diag(icd),
            advice,
            serviceType: SERVICE[svc],
            medicines: meds.map(([name, quantity, note]) => ({
                name, type: medByName[name].type, quantity, unit: medByName[name].unit, note: note || (medByName[name].usage[0] || '')
            })),
            location,
            createdDate: Timestamp.fromDate(created),
            createdBy: pick(NURSES)
        });
    };
    // กระจายการเข้ารับบริการย้อนหลัง ~4 เดือน และหนาแน่นในเดือนปัจจุบัน
    for (let i = 0; i < 150; i++) addVisit(pick(employees), randInt(0, 120));
    for (let i = 0; i < 40; i++) addVisit(pick(employees), randInt(0, new Date().getDate() - 1));
    // พนักงาน 3 คนสุดท้ายยังไม่มีประวัติการรักษา (ใช้ดู empty state)
    for (const p of [...store.keys()]) {
        if (/^employees\/emp02[6-8]\/opdCard\//.test(p)) store.delete(p);
    }

    // ----- queue (คิวรอตรวจวันนี้ ที่ location ของผู้ใช้) -----
    const QLOC = LOCATIONS[0];
    const today = ymd(new Date());
    const ago = (min) => Timestamp.fromDate(new Date(Date.now() - min * 60000));
    // [no, empIdx, status, esi, cc, arrivedMinAgo, startedMinAgo, observe/closeMinAgo, extra]
    const QUEUE = [
        [7, 3, 'done', 4, 'ไอมีเสมหะ 3 วัน', 160, 150, 135, {}],
        [8, 9, 'referred', 3, 'ข้อเท้าพลิกขณะเดินลงบันได', 150, 140, 120, {}],
        [9, 5, 'done', 4, 'แผลถลอกที่แขนจากการทำงาน', 130, 122, 110, {}],
        [10, 7, 'done', 4, 'ปวดท้องประจำเดือน', 100, 90, 70, {}],
        [6, 15, 'cancelled', 4, 'ตาแดง เคืองตา', 170, null, 140, { cancelReason: 'กลับไปทำงานก่อน' }],
        [11, 11, 'observe', 2, 'ใจสั่น เหงื่อออก หน้ามืด · DTX 62', 50, 44, 34, {}],
        [12, 13, 'in_progress', 4, 'ปวดศีรษะตั้งแต่เช้า', 40, 12, null, {}],
        [13, 1, 'waiting', 3, 'ถูกของมีคมบาดนิ้วมือ เลือดซึม', 37, null, null, {}],
        [14, 9 + 8, 'waiting', 4, 'ปวดหลังส่วนล่างหลังยกของ', 31, null, null, {}],
        [15, 19, 'waiting', 5, 'ขอวัดความดัน ปวดตึงต้นคอ', 23, null, null, {}],
        [16, 21, 'waiting', 2, 'หายใจมีเสียงวี้ด เหนื่อย', 19, null, null, {}],
        [17, 23, 'waiting', 4, 'มีน้ำมูก คัดจมูก 2 วัน', 14, null, null, {}],
        [18, 25, 'waiting', 3, 'เวียนศีรษะ บ้านหมุน คลื่นไส้', 12, null, null, { retriage: [4, 3, 6] }],
    ];
    QUEUE.forEach(([no, ei, status, esi, cc, arr, start, end, extra]) => {
        const by = pick(NURSES);
        const doc = {
            date: today, location: QLOC, no, employeeDocId: employees[ei], chiefComplaint: cc, esi, status,
            esiHistory: extra.retriage ? [{ from: extra.retriage[0], to: extra.retriage[1], at: ago(extra.retriage[2]), by }] : [],
            arrivedAt: ago(arr), createdAt: ago(arr), updatedAt: ago(end ?? start ?? arr), createdBy: by,
        };
        if (start !== null) { doc.startedAt = ago(start); doc.assignedTo = by; }
        if (status === 'observe') doc.observeAt = ago(end);
        if (['done', 'referred', 'cancelled'].includes(status)) { doc.closedAt = ago(end); doc.closedBy = by; }
        if (extra.cancelReason) doc.cancelReason = extra.cancelReason;
        put(`queue/q${String(no).padStart(3, '0')}`, doc);
    });
    put(`queueCounter/${QLOC.replace(/\//g, '_')}_${today}`, { location: QLOC, date: today, last: 18 });
    // คิวค้างจากเมื่อวาน (ยังไม่ปิด) 2 คิว + คิวที่ปิดแล้ว 1 คิว (ต้องไม่ถูกนับเป็นคิวค้าง)
    const yday = new Date(); yday.setDate(yday.getDate() - 1);
    const ydayStr = ymd(yday);
    const yAt = (h, m) => { const d = new Date(yday); d.setHours(h, m, 0, 0); return Timestamp.fromDate(d); };
    [[21, 2, 'waiting', 4, 'ปวดศีรษะ', yAt(16, 40)], [22, 4, 'in_progress', 3, 'แผลถลอกที่เข่า', yAt(17, 5)], [20, 6, 'done', 4, 'ไอ', yAt(15, 10)]]
        .forEach(([no, ei, status, esi, cc, at]) => put(`queue/y${no}`, {
            date: ydayStr, location: QLOC, no, employeeDocId: employees[ei], chiefComplaint: cc, esi, status, esiHistory: [],
            arrivedAt: at, createdAt: at, updatedAt: at, createdBy: NURSES[1],
            ...(status !== 'waiting' ? { startedAt: at, assignedTo: NURSES[1] } : {}),
            ...(status === 'done' ? { closedAt: at, closedBy: NURSES[1] } : {}),
        }));

    console.info('%c[MOCK] ใช้ข้อมูลจำลอง — ไม่มีการเชื่อมต่อฐานข้อมูลจริง', 'color:#00A3B8;font-weight:bold',
        { employees: employees.length, opdCards: [...store.keys()].filter(p => p.includes('/opdCard/')).length, medicines: MEDICINES.length });
})();
