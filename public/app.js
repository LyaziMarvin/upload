// app.js
// -------- Auth bootstrap --------
const token = localStorage.getItem('token');
if (!token) { window.location.href = "login.html"; }

let __currentUser = null;
let __currentRecordId = null;

// Track active document and ready state (for QA)
let __activeRecordId = null;    // id of the active document
let __documentReady = false;    // true when warm-up preprocessing completed

// Track in-flight document preparation (topic generation)
let __prepSeq = 0;
let __prepRecordId = null;
let __prepPromise = null;

function cancelActivePreparation() {
  __prepSeq += 1; // invalidates any in-flight completion handlers
  __prepRecordId = null;
  __prepPromise = null;
}

// In-memory conversations per record id
// structure: { [recordId]: [{ from: 'user' | 'bot', text: string, beganAt?: number, finishedAt?: number }] }
const __conversations = {};

// -------- Auth / current user --------
async function loadCurrentUser() {
  try {
    const r = await window.api.getCurrentUser(token);
    if (r?.success && r.data) { __currentUser = r.data; }
  } catch (_) {}
  return __currentUser;
}

function logout() {
  try { window.api.logout?.(); } catch (e) {}
  if (slmProbeTimer) { clearInterval(slmProbeTimer); slmProbeTimer = null; }
  localStorage.clear();
  window.location.href = "login.html";
}

// -------- Inline notices (uploads) --------
function showRecordMessage(type, text) {
  const el = document.getElementById('recordMessage');
  if (!el) return;
  const color = type === 'success' ? '#0a7b34' : (type === 'danger' ? '#8c1c13' : '#3a3a3a');
  el.innerHTML = `<div style="padding:6px 10px;border-radius:6px;background:#f7f7f7;color:${color};border:1px solid rgba(0,0,0,08)">${text}</div>`;
  setTimeout(() => { if (el.textContent && el.textContent.includes(text)) el.innerHTML = ''; }, 4000);
}

// -------- Ollama status --------
let slmActive = false;
let slmProbeTimer = null;

function updateSLMStatus() {
  const a = document.getElementById("slmArrow");
  const t = document.getElementById("slmText");
  if (!a || !t) return;
  if (slmActive) { a.textContent = "🟢"; t.textContent = "Ollama Active"; }
  else { a.textContent = "🔴"; t.textContent = "Ollama Inactive"; }
}

async function probeOllama() {
  const arrow = document.getElementById("slmArrow");
  const text  = document.getElementById("slmText");
  if (!arrow || !text) return;
  try {
    text.textContent = "Checking...";
    const status = await window.api.getOllamaStatus();
    slmActive = !!status?.running;
    if (slmActive) {
      arrow.textContent = "🟢";
      text.textContent  = `Ollama${status.version ? " v" + status.version : ""} running`;
    } else {
      arrow.textContent = "🔴";
      text.textContent  = "Ollama not reachable";
    }
  } catch (e) {
    slmActive = false;
    arrow.textContent = "❌";
    text.textContent  = "Check failed";
  }
  updateSLMStatus();
}

async function startOllamaWatch() {
  try { await window.api.ensureOllamaStarted(); } catch (_) {}
  await probeOllama();
  if (slmProbeTimer) clearInterval(slmProbeTimer);
  slmProbeTimer = setInterval(probeOllama, 2000);
}

const slmToggleBtn = document.getElementById("slmToggleBtn");
if (slmToggleBtn) {
  slmToggleBtn.hidden = false;
  slmToggleBtn.textContent = "Recheck Ollama";
  slmToggleBtn.onclick = probeOllama;
}
updateSLMStatus();

// -------- Section switching --------
function showSection(id) {
  document.querySelectorAll('.section').forEach(div => div.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');

  const titles = {
    dashboard: "🏠 Dashboard",
    profile: "🙍‍♂️ User Profile",
    upload: "📄 Shared Documents",
    installedAgents: "🧠 Installed Agents",
    qa: "💬 Ask a Question"
  };
  const titleEl = document.getElementById("sectionTitle");
  if (titleEl) titleEl.textContent = titles[id] || id;

  if (id === 'installedAgents') {
    loadAgentTemplates();
    const af = document.getElementById("agentFeatureContent");
    if (af) af.textContent = "Select a feature to view its details.";
  }
  if (id === 'upload') loadDocumentRecords();
  if (id === 'profile') loadProfile();
  if (id === 'qa') {
    applyModelUIFromStorage();
    updateCollectionBadge();
    updateQAActiveMeta();
    updateAskControlsUI();
    // NEW: render conversation for active doc when entering QA
    renderConversation(__activeRecordId);
  }
}
// -------- Profile --------
async function loadProfile() {
  const el = document.getElementById("profileDetails");
  if (!el) return;
  el.textContent = '⏳ Loading.';
  try {
    const r = await window.api.getCurrentUser(token);
    if (r && r.success) {
      const u = r.data || {};
      __currentUser = u;
      updateCollectionBadge();

      el.innerHTML = `
        <div class="d-flex align-items-center gap-3">
          <img src="${u.profile_photo_path ? `file://${u.profile_photo_path}` : ''}" 
               alt="Profile photo" 
               style="width:48px;height:48px;border-radius:50%;object-fit:cover;${u.profile_photo_path ? '' : 'display:none;'}"
               id="profileDetailsPhoto">
          <div>
            <div><strong>${u.name || 'Unnamed User'}</strong></div>
            <div class="small-muted">${u.email || 'N/A'}</div>
          </div>
        </div>
      `;

      const form = document.getElementById("profileForm");
      if (form) form.style.display = 'block';

      const emailEl   = document.getElementById("profileEmail");
      const nameEl    = document.getElementById("profileName");
      const phoneEl   = document.getElementById("profilePhone");
      const dobEl     = document.getElementById("profileDob");
      const ageEl     = document.getElementById("profileAge");
      const genderEl  = document.getElementById("profileGender");
      const addrEl    = document.getElementById("profileAddress");
      const preview   = document.getElementById("profilePhotoPreview");

      if (emailEl)  emailEl.value  = u.email || '';
      if (nameEl)   nameEl.value   = u.name || '';
      if (phoneEl)  phoneEl.value  = u.phone || '';
      if (dobEl)    dobEl.value    = u.dob || '';
      if (ageEl)    ageEl.value    = (u.age ?? '') === null ? '' : (u.age ?? '');
      if (genderEl) genderEl.value = u.gender || '';
      if (addrEl)   addrEl.value   = u.address || '';

      if (preview) {
        if (u.profile_photo_path) {
          preview.src = `file://${u.profile_photo_path}`;
          preview.style.display = '';
        } else {
          preview.style.display = 'none';
        }
      }

      const photoInput = document.getElementById("profilePhoto");
      if (dobEl && ageEl) {
        dobEl.addEventListener("change", () => {
          const dobStr = dobEl.value;
          if (dobStr) {
            const today = new Date();
            const [y,m,d] = dobStr.split('-').map(Number);
            if (y && m && d) {
              let age = today.getFullYear() - y;
              const bd = new Date(y, m - 1, d);
              const hasHadBirthday =
                (today.getMonth() > bd.getMonth()) ||
                (today.getMonth() === bd.getMonth() && today.getDate() >= bd.getDate());
              if (!hasHadBirthday) age -= 1;
              ageEl.value = Math.max(0, age);
            }
          }
        });
      }

      if (photoInput && preview) {
        photoInput.addEventListener("change", (e) => {
          const file = e.target.files?.[0];
          if (file) {
            const src = file.path ? `file://${file.path}` : URL.createObjectURL(file);
            preview.src = src;
            preview.style.display = '';
          }
        });
      }

      const saveBtn = document.getElementById("saveProfileBtn");
      const saveEl  = document.getElementById("saveStatus");

      if (saveBtn && saveEl) {
        saveBtn.onclick = async () => {
          const updatedData = {
            email:   emailEl?.value.trim()   || '',
            name:    nameEl?.value.trim()    || '',
            phone:   phoneEl?.value.trim()   || '',
            dob:     dobEl?.value || null,
            age:     ageEl?.value,
            gender:  genderEl?.value || null,
            address: addrEl?.value.trim()    || '',
          };

          const photoFile = photoInput?.files?.[0];
          if (photoFile && photoFile.path) updatedData.photoPath = photoFile.path;

          if (updatedData.age === '' || isNaN(Number(updatedData.age))) {
            updatedData.age = null;
          } else {
            updatedData.age = Number(updatedData.age);
          }

          saveEl.textContent = 'Saving...';

          try {
            let res = null;
            if (window.api?.updateUserProfile) {
              res = await window.api.updateUserProfile(updatedData, token);
            } else if (window.api?.updateCurrentUser) {
              res = await window.api.updateCurrentUser(token, updatedData);
            } else if (window.api?.updateProfile) {
              res = await window.api.updateProfile(token, updatedData);
            } else if (window.api?.saveProfile) {
              res = await window.api.saveProfile(token, updatedData);
            } else {
              throw new Error("No update method found (updateUserProfile / updateCurrentUser / updateProfile / saveProfile).");
            }

            if (res && res.success) {
              saveEl.textContent = '✅ Saved successfully!';
              const nu = res.data || {};
              __currentUser = nu;
              updateCollectionBadge();
              const detailsImg = document.getElementById('profileDetailsPhoto');
              if (nu.profile_photo_path && detailsImg && preview) {
                detailsImg.src = `file://${nu.profile_photo_path}`;
                detailsImg.style.display = '';
                preview.src = `file://${nu.profile_photo_path}`;
                preview.style.display = '';
              }
            } else {
              saveEl.textContent = `❌ ${(res && res.error) || 'Failed to save.'}`;
            }
          } catch (e) {
            saveEl.textContent = `❌ ${e.message || 'Error'}`;
          } finally {
            setTimeout(() => (saveEl.textContent = ''), 4000);
          }
        };
      }
    } else {
      el.textContent = `❌ ${(r && r.error) || 'Failed to load profile.'}`;
    }
  } catch (err) {
    el.textContent = `❌ ${err.message || 'Failed to load profile.'}`;
  }
}

// -------- Uploads (docs/photos/music) --------
function selectUploadTab(tabId) {
  document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
  const el = document.getElementById(tabId);
  if (el) el.classList.add('active');
  if (tabId === 'photos') loadUploadedPhotos();
  if (tabId === 'music') loadUploadedMusic();
}

// Auto-summary popover
function showAutoSummary(text) {
  const box = document.getElementById('autoSummaryBox');
  const txt = document.getElementById('autoSummaryText');
  if (!box || !txt) return;
  txt.textContent = text || 'No summary available.';
  box.style.display = '';
  box.style.transition = 'transform 220ms ease, box-shadow 220ms ease, opacity 220ms ease';
  box.style.transform = 'translateY(-6px)';
  box.style.opacity = '0.98';
  setTimeout(() => {
    box.style.transform = '';
    setTimeout(() => {
      box.style.opacity = '0';
      setTimeout(() => { box.style.display = 'none'; box.style.opacity = ''; }, 12000);
    }, 12000);
  }, 10);
}

// Startup auto-summary (non-stream) – respects global mode
 async function runAutoSummaryAtStartup() {
  if (!token) return;
  try {
    const list = await window.api.getAllRecords(token);
    const latest = (list && list.success && Array.isArray(list.data) && list.data.length)
      ? list.data[0]
      : null;

    if (!latest?.id) return;

    __activeRecordId = latest.id;
    __currentRecordId = latest.id;
    updateQAActiveMeta();

    const existingTopic = (latest.topic && String(latest.topic).trim()) ? String(latest.topic).trim() : '';

    // Always warm up the active document on login and block QA until it's done.
    __documentReady = false;
    updateAskControlsUI();
    showAutoSummary(existingTopic || 'Preparing document topic...');

    // Ensure the "preparing" UI is visible when the user opens Shared Documents.
    const topicEl = document.getElementById("extractedText");
    if (topicEl) {
      topicEl.innerHTML = `
        <div class="preparing-box">
          <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
          <div>Preparing document for questions... This may take a couple of minutes, depending on the size of the document.</div>
        </div>
      `;
    }

    setActiveRecordAndPrepare(latest.id, false, true, { forceWarmup: true, existingTopic }).catch(() => {});
  } catch (e) {
    console.warn('Auto-summary startup failed:', e);
  }
}

// Try to save topic to backend (if API exists)
async function trySaveTopicForRecord(recordId, topicText) {
  if (!recordId || !topicText) return;
  try {
    if (typeof window.api.saveTopic === 'function') {
      await window.api.saveTopic(recordId, topicText, token);
    } else if (typeof window.api.updateRecordTopic === 'function') {
      await window.api.updateRecordTopic(recordId, { topic: topicText }, token);
    } else {
      // no topic-saving API; silently ignore
    }
  } catch (e) {
    console.warn('Saving topic failed (nonfatal):', e);
  }
}

async function handleUpload() {
  const docInput = document.getElementById("docUpload");
  const doc = docInput?.files?.[0];
  const statusEl = document.getElementById("uploadStatus");
  if (!statusEl) return;
  if (!token || !doc) {
    statusEl.textContent = "❌ Please log in and select a document.";
    return;
  }

  const okMime = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];
  const name = (doc.name || "").toLowerCase();
  const byExt = name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx");
  const byMime = okMime.includes(doc.type);
  if (!byExt && !byMime) {
    statusEl.textContent = "❌ Only .pdf, .doc, or .docx files are allowed.";
    return;
  }

  statusEl.textContent = '⏳ Uploading...';
  try {
    // If a topic prep is still running, supersede it with this new upload.
    cancelActivePreparation();

    const res = await window.api.uploadFiles({ docPath: doc.path, photoPaths: [], musicPaths: [], token });
    statusEl.textContent = res && res.success ? "✅ Import successful" : `❌ ${(res && res.error) || 'Upload failed.'}`;

    if (res && res.success) {
      await loadDocumentRecords();
      // Auto-select newly uploaded record; topic is returned/saved by backend.
      try {
        const recordId = res.data && res.data.recordId;
        if (recordId) {
          __activeRecordId = recordId;
          __currentRecordId = recordId;
          markActiveInList(recordId);
          updateQAActiveMeta();

          const topicText = res.data?.topic || res.data?.autoAnswer || '';
          const topicEl = document.getElementById("extractedText");
          if (topicEl) topicEl.textContent = topicText || 'Topic will appear shortly...';

          if (topicText && String(topicText).trim()) {
            __documentReady = true;
            updateAskControlsUI();
            showAutoSummary(topicText);
          } else {
            // Fallback: generate topic if backend couldn't produce it.
            __documentReady = false;
            updateAskControlsUI();
            await setActiveRecordAndPrepare(recordId, true, true);
          }
        }
      } catch (e) {
        console.warn('Auto-summary after upload failed:', e);
      }
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Upload failed.'}`;
  }
}

const docUploadEl = document.getElementById("docUpload");
if (docUploadEl) {
  docUploadEl.addEventListener("change", handleUpload);
}

// -------- Document list & selection --------
async function loadDocumentRecords() {
  const c = document.getElementById("recordItems");
  if (!c) return;

  c.innerHTML = '<div class="small-muted">⏳ Loading records.</div>';

  try {
    const res = await window.api.getAllRecords(token);
    c.innerHTML = '';

    const metaEl   = document.getElementById("selectedFileMeta");
    const topicEl  = document.getElementById("extractedText");
    const regenBtn = document.getElementById("regenTopicBtn");

    if (!res || !res.success || !Array.isArray(res.data) || res.data.length === 0) {
      c.innerHTML = '<div class="text-muted">No files found.</div>';
      if (metaEl)  metaEl.textContent = '';
      if (topicEl) topicEl.textContent = '';
      if (regenBtn) regenBtn.disabled = true;
      __currentRecordId = null;
      __activeRecordId  = null;
      __documentReady   = false;
      updateQAActiveMeta();
      updateAskControlsUI();
      return;
    }

    // Find most recent record by uploaded_at if available
    let mostRecent = null;
    try {
      mostRecent = res.data.slice().reduce((best, cur) => {
        const a = best && best.uploaded_at ? new Date(best.uploaded_at) : null;
        const b = cur && cur.uploaded_at ? new Date(cur.uploaded_at) : null;
        if (!a && !b) return best || cur;
        if (!a) return cur;
        if (!b) return best;
        return b > a ? cur : best;
      }, res.data[0]);
    } catch (e) {
      mostRecent = res.data[0];
    }

    res.data.forEach(r => {
      const row = document.createElement("div");
      row.className  = "record-item";
      row.dataset.id = r.id;

      const uploadedLabel = r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString() : '';

      row.innerHTML = `
        <div class="doc-name-wrap">
          <div class="doc-name">${r.file_name || ('Record ' + r.id)}</div>
          <div class="doc-status">
            ${r.id === __activeRecordId ? '<span style="color:#d9534f">Active</span>' : 'Not Active'}
          </div>
        </div>

        <div class="doc-topic">${r.topic || '—'}</div>

        <div class="doc-date small-muted">
          ${uploadedLabel}
          <button
            type="button"
            class="btn btn-sm"
            style="margin-left:8px; font-size:14px;"
            title="Delete">
            🗑️
          </button>
        </div>
      `;

      const delBtn = row.querySelector('button');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteRecord(r.id);
        });
      }

      row.onclick = async () => {
        try {
          await setActiveRecordAndPrepare(r.id, false);
        } catch (err) {
          if (topicEl) {
            topicEl.textContent = `❌ ${err.message || 'Error'}`;
          }
        }
      };

      c.appendChild(row);
    });

    // If we don't have an active record yet, pick the most recent
    if (!__activeRecordId && mostRecent) {
      __activeRecordId = mostRecent.id;
    }

    if (__activeRecordId) {
      markActiveInList(__activeRecordId);
      // Avoid auto-prepare here to prevent duplicate requests.
      if (!__currentRecordId) __currentRecordId = __activeRecordId;
    }
  } catch (err) {
    c.innerHTML = `<div class="text-danger">❌ ${(err && err.message) || 'Failed to load records.'}</div>`;
  }
}

async function deleteRecord(id) {
  if (!id) return;

  const confirmed = window.confirm("Are you sure you want to delete this document? This cannot be undone.");
  if (!confirmed) return;

  try {
    const res = await window.api.deleteRecord(id, token);
    if (res && res.success) {
      showRecordMessage("success", "Document deleted successfully.");
      await loadDocumentRecords();
    } else {
      showRecordMessage("danger", (res && res.error) || "Failed to delete.");
    }
  } catch (err) {
    showRecordMessage("danger", err.message || "Error deleting file.");
  }
}

// Mark active record in list + update topic header meta
function markActiveInList(recordId) {
  document.querySelectorAll('.record-item').forEach(el => {
    const id   = Number(el.dataset.id);
    const mark = el.querySelector('.active-mark');
    const status = el.querySelector('.doc-status');

    if (id === Number(recordId)) {
      el.classList.add('active');
      if (mark)   mark.style.display = '';
      if (status) status.innerHTML = '<span style="color:#d9534f">Active</span>';
    } else {
      el.classList.remove('active');
      if (mark)   mark.style.display = 'none';
      if (status) status.textContent = 'Not Active';
    }
  });

  // Also update topic header meta
  (async () => {
    try {
      const s = await window.api.getRecordById(recordId, token);
      if (s && s.success && s.data) {
        const fl = s.data.file_name || `Record ${recordId}`;
        const dl = s.data.uploaded_at || '';
        const metaEl = document.getElementById("selectedFileMeta");
        if (metaEl) metaEl.textContent = `${fl}${dl ? ' • ' + dl : ''}`;
        updateQAActiveMeta();
      }
    } catch (_) {}
  })();
}

// Prepare active record (warm-up + topic) BEFORE questions
async function setActiveRecordAndPrepare(recordId, calledAfterUpload = false, silentAuto = false, opts = {}) {
  // Reuse any in-flight prep for the same record to avoid duplicate requests.
  if (__prepPromise && __prepRecordId === recordId) return __prepPromise;
  const mySeq = (__prepSeq += 1);
  __prepRecordId = recordId;

  __prepPromise = (async () => {
  __activeRecordId = recordId;
  __currentRecordId = recordId;
  __documentReady = false;       // lock questions while preparing
  markActiveInList(recordId);
  updateQAActiveMeta();
  updateAskControlsUI();         // immediately show “document is being prepared”

  const topicEl = document.getElementById("extractedText");

  const forceWarmup = !!opts.forceWarmup;
  let existingTopic = (opts.existingTopic && String(opts.existingTopic).trim()) ? String(opts.existingTopic).trim() : '';

  // If we weren't provided a topic, check DB (fast).
  if (!existingTopic) {
    try {
      const existing = await window.api.getRecordById(recordId, token);
      const t = existing?.success ? (existing.data?.topic || '') : '';
      if (t && String(t).trim()) existingTopic = String(t).trim();
    } catch (_) {}
  }

  // If topic already exists and we are not forcing warm-up, skip regeneration entirely.
  if (existingTopic && !forceWarmup) {
    if (topicEl) topicEl.textContent = existingTopic;
    showAutoSummary(existingTopic);
    __documentReady = true;
    updateAskControlsUI();
    return;
  }

  if (topicEl) {
    topicEl.innerHTML = `
      <div class="preparing-box">
        <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
        <div>Preparing document for questions... This may take a couple of minutes, depending on the size of the document.</div>
      </div>
    `;
  }

  try {
    const q = "What is the main topic of this document?";
    const scope = { type: 'ids', ids: [recordId] };
    const res = await askBackend(q, scope);

    // Ignore stale completions (e.g., a newer upload/prep superseded this one)
    if (mySeq !== __prepSeq) return;

    if (res && res.success && res.answer) {
      const topicText = existingTopic || res.answer || '(No topic generated)';
      if (topicEl) topicEl.textContent = topicText;
      showAutoSummary(topicText);
      if (!existingTopic) trySaveTopicForRecord(recordId, topicText);
      __documentReady = true;
      const info = document.getElementById('streamStartInfo');
      if (info) info.textContent = '✅ Warm-up complete. Ready for questions.';
      const modelNoticeText = document.getElementById('modelNoticeText');
      if (modelNoticeText) modelNoticeText.textContent = 'Ready for questions.';
      if (!silentAuto) showRecordMessage('success', 'Document prepared and ready for queries.');
    } else {
      const errText = (res && res.error) || 'Warm-up failed.';
      if (topicEl) topicEl.textContent = `❌ ${errText}`;
      if (!silentAuto) showRecordMessage('danger', `❌ ${errText}`);
      __documentReady = false;
    }
  } catch (e) { if (mySeq !== __prepSeq) return;
    if (topicEl) topicEl.textContent = `❌ ${e.message || 'Error preparing document.'}`;
    __documentReady = false;
  } finally {
    if (mySeq !== __prepSeq) return;
    const regenBtn = document.getElementById("regenTopicBtn");
    if (regenBtn) regenBtn.disabled = false;
    updateQAActiveMeta();
    updateAskControlsUI();   // finally update textbox & button
    __prepRecordId = null;
    __prepPromise = null;
  }
  })();

  return __prepPromise;
}

// -------- Photos --------
function displayPhotos(photoPaths) {
  const container = document.getElementById('uploadedPhotos');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) {
    container.innerHTML = '<div class="small-muted">No photos uploaded.</div>';
    return;
  }
  photoPaths.forEach(photoPath => {
    const img = document.createElement('img');
    img.src = `file://${photoPath}`;
    img.style.width = '120px';
    img.style.height = '120px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    container.appendChild(img);
  });
}

async function loadUploadedPhotos() {
  const statusEl = document.getElementById("photoUploadStatus");
  if (!statusEl) return;
  statusEl.textContent = '⏳ Loading photos.';
  try {
    const res = await window.api.getAllPhotos(token);
    if (res && res.success) {
      displayPhotos(res.data || []);
      statusEl.textContent = '';
    } else {
      statusEl.textContent = `❌ ${(res && res.error) || 'Failed to load photos.'}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Failed to load photos.'}`;
  }
}

async function loadUploadedMusic() {
  const statusEl = document.getElementById("musicUploadStatus");
  if (!statusEl) return;
  statusEl.textContent = '⏳ Loading music.';
  try {
    const res = await window.api.getAllMusic(token);
    if (res && res.success) {
      displayMusic(res.data || []);
      statusEl.textContent = '';
    } else {
      statusEl.textContent = `❌ ${(res && res.error) || 'Failed to load music.'}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Failed to load music.'}`;
  }
}

function displayMusic(trackPaths) {
  const container = document.getElementById('uploadedMusic');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(trackPaths) || trackPaths.length === 0) {
    container.innerHTML = '<div class="small-muted">No music uploaded.</div>';
    return;
  }

  trackPaths.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center justify-content-between border rounded p-2';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center gap-2';
    const name = document.createElement('span');
    name.textContent = `🎵 ${p.split(/[\\/]/).pop()}`;
    left.appendChild(name);

    const right = document.createElement('div');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = `file://${p}`;
    audio.style.width = '260px';
    right.appendChild(audio);

    row.appendChild(left);
    row.appendChild(right);
    container.appendChild(row);
  });
}

const photoUploadEl = document.getElementById("photoUpload");
if (photoUploadEl) {
  photoUploadEl.addEventListener("change", async () => {
    const photos = Array.from(photoUploadEl.files || []);
    const statusEl = document.getElementById("photoUploadStatus");
    if (!statusEl) return;
    if (!token || !photos.length) { statusEl.textContent = "❌ Please select photos to upload."; return; }
    statusEl.textContent = '⏳ Uploading photos...';
    try {
      const photoPaths = photos.map(f => f.path);
      const res = await window.api.uploadFiles({ docPath: null, photoPaths, musicPaths: [], token });
      statusEl.textContent = res && res.success ? "✅ Photos uploaded!" : `❌ ${(res && res.error) || 'Upload failed.'}`;
      if (res && res.success) loadUploadedPhotos();
    } catch (err) {
      statusEl.textContent = `❌ ${err.message || 'Upload failed.'}`;
    }
  });
}

const musicUploadEl = document.getElementById("musicUpload");
if (musicUploadEl) {
  musicUploadEl.addEventListener("change", async () => {
    const musicFiles = Array.from(musicUploadEl.files || []);
    const statusEl = document.getElementById("musicUploadStatus");
    if (!statusEl) return;
    if (!token || !musicFiles.length) { statusEl.textContent = "❌ Please select music files to upload."; return; }
    statusEl.textContent = '⏳ Uploading music...';
    try {
      const musicPaths = musicFiles.map(f => f.path);
      const res = await window.api.uploadFiles({ docPath: null, photoPaths: [], musicPaths, token });
      statusEl.textContent = res && res.success ? "✅ Music uploaded!" : `❌ ${(res && res.error) || 'Upload failed.'}`;
      if (res && res.success) loadUploadedMusic();
    } catch (err) {
      statusEl.textContent = `❌ ${err.message || 'Upload failed.'}`;
    }
  });
}

// -------- Model selection + collection badge --------
const MODEL_KEY = 'qaModel';           // 'offline' | 'online' | 'none'
const EMBED_MODEL_UI = 'all-minilm';   // keep in sync with backend
function modelKey() { return EMBED_MODEL_UI.replace(/[^a-z0-9]+/gi, '_'); }
function collectionNameForUser(userId) { return userId ? `user_${userId}_records_${modelKey()}` : '—'; }

// Now this does nothing visible (badge removed from HTML)
function updateCollectionBadge() {
  const badge = document.getElementById('collectionBadge');
  if (!badge) return;

  const state = getStoredModel();
  const uid = __currentUser?.id;
  if (!uid) return;

  const name = collectionNameForUser(uid);
  // If you ever re-add the badge to the UI, you can show it like this:
  // badge.textContent = `Index: ${name}`;
  // badge.className = state === 'none' ? 'badge bg-info text-dark' : 'badge bg-success';
}

function getStoredModel() { return localStorage.getItem(MODEL_KEY) || 'none'; }
function storeModel(value) { localStorage.setItem(MODEL_KEY, value); }

// Global helper: choose online/offline backend based on mode
async function askBackend(question, scope = { type: 'all' }, opts = {}) {
  const mode = getStoredModel(); // 'online' | 'offline' | 'none'

  if (mode === 'offline') {
    return window.api.askQuestionOff(question, token, scope);
  }
  if (mode === 'online') {
    return window.api.askQuestionOn(question, token, scope, opts);
  }

  throw new Error('App mode not set. Please logout and log in again.');
}

// Header mode + Ollama visibility
function updateHeaderModeUI(state) {
  const mode = state || getStoredModel();
  const slmBox = document.getElementById('slmStatus');
  const headerModeEl = document.getElementById('modeStatusHeader');
  const toggleBtn = document.getElementById('slmToggleBtn');

if (headerModeEl) {
  if (mode === 'offline') {
    headerModeEl.textContent = 'Mode: Local Mode (offline)';
  } else if (mode === 'online') {
    headerModeEl.textContent = 'Mode: Hosted Mode (online)';
  } else {
    headerModeEl.textContent = 'Mode: —';
  }
}


  const showSLM = (mode === 'offline');

  if (slmBox) {
    slmBox.style.display = showSLM ? 'flex' : 'none';
  }
  if (toggleBtn) {
    toggleBtn.style.display = showSLM ? 'inline-block' : 'none';
  }
}

function updateModelBadge(state) {
  const badge = document.getElementById('modelStatusBadge');
  if (!badge) return;

  if (state === 'none') {
    badge.textContent = 'Mode not set';
    badge.className = 'badge bg-warning text-dark';
  } else if (state === 'offline') {
    badge.textContent = 'Mode: Local / Offline';
    badge.className = 'badge bg-success';
  } else if (state === 'online') {
    badge.textContent = 'Mode: Online Granite';
    badge.className = 'badge bg-success';
  }

  // Keep header in sync with this mode
  updateHeaderModeUI(state);
}

function clearModelButtonsActive() {
  ['btnModelOffline','btnModelOnline'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('btn-primary');
    el.classList.add('btn-outline-secondary');
  });
}
function activateButton(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('btn-outline-secondary');
  el.classList.add('btn-primary');
}

function emphasizeNotice() {
  const picker = document.getElementById('modelPicker');
  const notice = document.getElementById('modelNotice');
  picker?.classList.add('attention');
  if (notice) {
    notice.style.boxShadow = '0 0 0 3px rgba(255,193,7,.35)';
    setTimeout(() => notice.style.boxShadow = '', 1200);
  }
  setTimeout(() => picker?.classList.remove('attention'), 1200);
}

// These listeners are effectively unused now (no buttons in HTML), but safe:
const btnOffline = document.getElementById('btnModelOffline');
if (btnOffline) {
  btnOffline.addEventListener('click', () => {
    storeModel('offline');
    updateModelBadge('offline');
    clearModelButtonsActive();
    activateButton('btnModelOffline');
    updateCollectionBadge();
    updateAskControlsUI();
  });
}

const btnOnline = document.getElementById('btnModelOnline');
if (btnOnline) {
  btnOnline.addEventListener('click', () => {
    storeModel('online');
    updateModelBadge('online');
    clearModelButtonsActive();
    activateButton('btnModelOnline');
    updateCollectionBadge();
    updateAskControlsUI();
  });
}

function applyModelUIFromStorage() {
  const st = getStoredModel();
  updateModelBadge(st);
  updateAskControlsUI();
}

// --- Map backend errors to friendly UI guidance ---
function mapErrorToFriendly(msg = '') {
  const m = (msg || '').toLowerCase();
  if (m.includes('not found') || m.includes('404')) {
    return '❌ No index found for this model. Please upload a document first so we can build your search index.';
  }
  if (m.includes('vector-size') || m.includes('mismatch') || m.includes('bad request')) {
    return '❌ Vector size mismatch. Your index was created with a different embedding model. Delete the old collection or re-upload to rebuild with the current model.';
  }
  if (m.includes('embedding') && m.includes('empty')) {
    return '❌ Embedding failed. Ensure the Ollama model (all-minilm) is available and running.';
  }
  return `❌ ${msg || 'An error occurred.'}`;
}

// -------- Streaming helpers (with timing) --------
function safeParseJSON(s) { try { return JSON.parse(s); } catch (_) { return null; } }

// Append streaming chunks into the current document's conversation
function appendToAnswer(text) {
  // If for some reason no active document, fall back to direct DOM append
  if (!__activeRecordId) {
    const area = document.getElementById('conversationArea');
    if (!area) return;
    area.innerHTML = (area.innerHTML || '') + (text || '');
    return;
  }

  if (!__conversations[__activeRecordId]) {
    __conversations[__activeRecordId] = [];
  }

  const conv = __conversations[__activeRecordId];

  // Find the last bot message, or create one if none
  let lastBot = null;
  for (let i = conv.length - 1; i >= 0; i--) {
    if (conv[i].from === 'bot') {
      lastBot = conv[i];
      break;
    }
  }
  if (!lastBot) {
    lastBot = { from: 'bot', text: '' };
    conv.push(lastBot);
  }

  lastBot.text += text || '';
  renderConversation(__activeRecordId);
}

// Render conversation for a given recordId
function renderConversation(recordId) {
  const area = document.getElementById('conversationArea');
  if (!area) return;

  area.innerHTML = '';

  if (!recordId || !__conversations[recordId] || __conversations[recordId].length === 0) {
    area.innerHTML = '<div class="small-muted">No conversation yet. Select a document to begin.</div>';
    return;
  }

  const conv = __conversations[recordId];

  conv.forEach(m => {
    const row = document.createElement('div');
    row.className = 'chat-row ' + (m.from === 'user' ? 'left' : 'right');

    const bubble = document.createElement('div');
    bubble.className = m.from === 'user' ? 'chat-message user' : 'chat-message bot';

    let meta = '';
    if (m.beganAt && typeof m.streamStartAt === 'number') {
      const base = typeof m.streamStartAt === 'number' ? m.streamStartAt : m.beganAt;
      const began = (Math.max(0, m.beganAt - base) / 1000).toFixed(2);
      meta += `<div class="msg-meta">✍️ Began: ${began}s</div>`;
    }
    if (m.finishedAt && typeof m.streamStartAt === 'number') {
      const base = typeof m.streamStartAt === 'number' ? m.streamStartAt : m.finishedAt;
      const done = (Math.max(0, m.finishedAt - base) / 1000).toFixed(2);
      meta += `<div class="msg-meta">✅ Completed: ${done}s</div>`;
    }

    bubble.innerHTML = meta + (m.text || '').replace(/\n/g, '<br/>');
    row.appendChild(bubble);
    area.appendChild(row);
  });

  area.scrollTop = area.scrollHeight;
}

// Add a message to a conversation
function addMessage(recordId, from, text) {
  if (!recordId) return;
  if (!__conversations[recordId]) __conversations[recordId] = [];
  __conversations[recordId].push({ from, text: text || '' });
  renderConversation(recordId);
}

// Clear chat for active record
function clearConversation() {
  if (!__activeRecordId) return;
  __conversations[__activeRecordId] = [];
  renderConversation(__activeRecordId);
}
window.clearConversation = clearConversation;

// startAskStream streams into conversationArea with timing info
function startAskStream(question, scope = { type: 'all' }, topK = 4, initiatedAt = null) {
  return new Promise((resolve) => {
    const startedAt = typeof initiatedAt === 'number' ? initiatedAt : performance.now();
    let answerCompleteAt = null;

    try { window.api.removeAskStreamListeners(); } catch (_) {}

    const answerEl = document.getElementById('conversationArea');

    const infoId = 'streamStartInfo';
    let infoBox = document.getElementById(infoId);
    if (!infoBox) {
      infoBox = document.createElement('div');
      infoBox.id = infoId;
      infoBox.className = 'mt-2 small-muted';
      if (answerEl) answerEl.insertAdjacentElement('beforebegin', infoBox);
    }
    infoBox.textContent = '⏳ Waiting for stream to start…';

    // Ensure conversation exists and create placeholder bot message for streaming
    if (__activeRecordId && !__conversations[__activeRecordId]) {
      __conversations[__activeRecordId] = [];
    }
    if (__activeRecordId) {
      __conversations[__activeRecordId].push({
        from: 'bot',
        text: '',
        streamStartAt: startedAt,
        beganAt: null,
        finishedAt: null
      });
      renderConversation(__activeRecordId);
    } else if (answerEl) {
      answerEl.innerHTML = '<div class="chat-row right"><div class="chat-message bot">...</div></div>';
    }

    let firstChunkAt = null;
    let firstTypedAt = null;

    function updateBanner() {
      const box = document.getElementById(infoId);
      if (!box) return;
      const parts = [];

      if (firstTypedAt) {
        const t = ((firstTypedAt - startedAt) / 1000).toFixed(2);
        parts.push(`✍️ Response began at ${t}s`);
      }
      if (answerCompleteAt && firstTypedAt) {
        const done = (Math.max(0, answerCompleteAt - startedAt) / 1000).toFixed(2);
        parts.push(`✅ Answer complete at ${done}s`);
      }

      if (parts.length) box.textContent = parts.join(' • ');
    }

    let stallTimer = setTimeout(() => {
      const waited = ((performance.now() - startedAt) / 1000).toFixed(2);
      const box = document.getElementById(infoId);
      if (box && !firstChunkAt) box.textContent = `⏳ Still waiting… ${waited}s`;
    }, 7000);

    function extractVisibleFromParsed(parsed) {
      if (!parsed) return '';
      if (typeof parsed.response === 'string') return parsed.response;
      if (typeof parsed.text === 'string') return parsed.text;
      if (typeof parsed.delta === 'string') return parsed.delta;
      if (typeof parsed.chunk === 'string') return parsed.chunk;
      if (typeof parsed.message === 'string') return parsed.message;
      return '';
    }

    const onChunk = (data) => {
      if (!data) return;

      const trimmed = String(data).trim();
      const parsed = safeParseJSON(trimmed);

      if (!firstChunkAt) {
        firstChunkAt = performance.now();
        clearTimeout(stallTimer);
        updateBanner();
      }

      // done event
      if (parsed && (parsed.type === 'done' || parsed.done === true)) {
        try { window.api.removeAskStreamListeners(); } catch {}
        clearTimeout(stallTimer);

        const doneAt = performance.now();
        answerCompleteAt = doneAt;

        if (__activeRecordId && __conversations[__activeRecordId]?.length) {
          const conv = __conversations[__activeRecordId];
          const last = conv[conv.length - 1];
          if (last) last.finishedAt = doneAt;
          renderConversation(__activeRecordId);
        }

        updateBanner();
        resolve({ success: true });
        return;
      }

      // ignore sources messages
      if (parsed && parsed.type === 'sources') return;

      const visible = parsed ? extractVisibleFromParsed(parsed) : trimmed;
      if (!visible) return;

      appendToAnswer(visible);

      if (!firstTypedAt && /\S/.test(visible)) {
        firstTypedAt = performance.now();
        if (__activeRecordId && __conversations[__activeRecordId]?.length) {
          const conv = __conversations[__activeRecordId];
          const last = conv[conv.length - 1];
          if (last && !last.beganAt) last.beganAt = performance.now();
        }
        updateBanner();
      }

      // Keep auto-summary synced with last bot message
      try {
        const lastBot = __conversations[__activeRecordId]
          ?.filter(m => m.from === 'bot')
          .slice(-1)[0];
        if (lastBot && lastBot.text) {
          showAutoSummary(lastBot.text.trim().slice(0, 4000));
        }
      } catch (_) {}
    };

    const onErr = (msg) => {
      try { window.api.removeAskStreamListeners(); } catch {}
      clearTimeout(stallTimer);
      const box = document.getElementById(infoId);
      if (box && !firstChunkAt) {
        const waited = ((performance.now() - startedAt) / 1000).toFixed(2);
        box.textContent = `⚠️ Stream failed after waiting ${waited}s`;
      }
      appendToAnswer(`\n\n❌ Stream error: ${msg}`);
      resolve({ success: false, error: msg });
    };

    window.api.onAskStreamChunk(onChunk);
    window.api.onAskStreamError(onErr);

    try {
      window.api.askStreamStart({ question, token, scope, topK });
    } catch (e) {
      try { window.api.removeAskStreamListeners(); } catch {}
      clearTimeout(stallTimer);
      resolve({ success: false, error: e?.message || String(e) });
    }
  });
}

// Update QA active meta (active doc name under header)
async function updateQAActiveMeta() {
  const nameEl = document.getElementById('qaActiveName');
  const docEl  = document.getElementById('qaActiveDocument');
  if (!nameEl || !docEl) return;

  if (!__activeRecordId) {
    nameEl.textContent = '—';
    docEl.textContent = '';
    return;
  }

  try {
    const s = await window.api.getRecordById(__activeRecordId, token);
    if (s && s.success && s.data) {
      const filename = s.data.file_name || (`Record ${__activeRecordId}`);
      nameEl.textContent = filename;
      docEl.innerHTML = `📄 Active Document: <span style="color:#0b5ed7">${filename}</span>`;
    } else {
      nameEl.textContent = `Record ${__activeRecordId}`;
      docEl.innerHTML = `📄 Active Document: <span style="color:#0b5ed7">Record ${__activeRecordId}</span>`;
    }
  } catch {
    nameEl.textContent = `Record ${__activeRecordId}`;
    docEl.innerHTML = `📄 Active Document: <span style="color:#0b5ed7">Record ${__activeRecordId}</span>`;
  }
}

// Central logic for locking/unlocking the question box & button
function updateAskControlsUI() {
  const qEl = document.getElementById('questionInput');
  const askBtn = document.getElementById('askBtn');
  if (!qEl || !askBtn) return;

  const chosen = getStoredModel();

  // No active document yet
  if (!__activeRecordId) {
    qEl.disabled = true;
    askBtn.disabled = true;
    qEl.placeholder = 'Document is still being prepared for questioning…';
    return;
  }

  // Document not ready yet
  if (!__documentReady) {
    qEl.disabled = true;
    askBtn.disabled = true;
    qEl.placeholder = 'Document is still being prepared for questioning…';
    return;
  }

  // No mode selected
  if (chosen === 'none') {
    qEl.disabled = true;
    askBtn.disabled = true;
    qEl.placeholder = 'App mode not set. Please logout and log in again.';
    return;
  }

  // Everything ready
  qEl.disabled = false;
  askBtn.disabled = false;
  qEl.placeholder = 'Type your question…';
}

// -------- Ask Question (QA) --------
async function askQuestion(preFilled = null) {
  const qEl = document.getElementById("questionInput");
  const convArea = document.getElementById("conversationArea");
  
  // Use passed text OR fallback to existing behavior
  const q = preFilled !== null ? preFilled.trim() : (qEl?.value || '').trim();


  if (!convArea) return;

  if (!__activeRecordId) {
    convArea.innerHTML = `<div class="small-muted">❌ No active document selected. Please select a document under Shared Documents first.</div>`;
    return;
  }

  if (!__documentReady) {
    convArea.innerHTML = `<div class="small-muted">❌ Document not ready — preprocessing in progress. Please wait for "Ready for questions."</div>`;
    return;
  }

  const chosen = (localStorage.getItem('qaModel') || 'none');
  if (chosen === 'none') {
    emphasizeNotice();
    convArea.innerHTML = `<div class="text-muted">
      App mode is not set. Please logout and log in again, choosing Online or Offline on the login screen.
    </div>`;
    updateAskControlsUI();
    return;
  }

  if (!q) {
    convArea.textContent = "❌ Please enter a question.";
    return;
  }

  // Always bind to active document
  const scope = { type: "ids", ids: [__activeRecordId] };

  // Store user question in conversation
  addMessage(__activeRecordId, 'user', q);

  // Optional warning if SLM offline but continue
  if (!slmActive) {
    const warnEl = document.createElement('div');
    warnEl.className = 'small-muted';
    warnEl.style.marginTop = '6px';
    warnEl.textContent = '⚠️ The system currently reports the SLM as unreachable — attempting to query anyway.';
    convArea.appendChild(warnEl);
  }

  await new Promise(requestAnimationFrame);

  try {
    const existingInfo = document.getElementById('streamStartInfo');
    if (existingInfo) existingInfo.remove();

    const initiatedAt = performance.now();
    const res = await startAskStream(q, scope, 4, initiatedAt);

    if (res && res.success) {
      if (qEl) qEl.value = '';
    } else {
      const errMsg = (res && res.error) ? String(res.error) : 'Stream ended abnormally.';
      const lower = errMsg.toLowerCase();
      if (lower.includes('ollama') || lower.includes('not reachable')) {
        appendToAnswer(`\n\n❌ The SLM is not reachable. Please ensure Ollama is running and reachable by the app.`);
      } else {
        appendToAnswer(`\n\n❌ ${errMsg}`);
      }
    }
  } catch (err) {
    console.error('QA error', err);
    const message = err?.message || String(err);
    const lower = message.toLowerCase();
    if (lower.includes('ollama') || lower.includes('not reachable')) {
      convArea.textContent = `❌ The SLM is not reachable. Please ensure Ollama is running.`;
    } else {
      convArea.textContent = `❌ ${message || 'Error'}`;
    }
  }
}

// --- Regenerate Topic button ---
async function regenerateTopicForCurrent() {
  const btn = document.getElementById('regenTopicBtn');
  const t = document.getElementById('extractedText');
  if (!btn || !t) return;
  if (!__currentRecordId) return;

  btn.disabled = true;
  const textBackup = t.textContent;
  t.textContent = '⏳ Regenerating topic…';
  try {
    if (typeof window.api.regenerateTopic === 'function') {
      const res = await window.api.regenerateTopic(__currentRecordId, token);
      if (res && res.success && res.data && res.data.topic) {
        t.textContent = res.data.topic;
        showRecordMessage('success', '✅ Topic updated.');
        await loadDocumentRecords(); // refresh list
      } else {
        t.textContent = textBackup;
        showRecordMessage('danger', `❌ ${(res && res.error) || 'Failed to regenerate topic'}`);
      }
    } else {
      const q = "What is the main topic of this document?";
      const scope = { type: 'ids', ids: [__currentRecordId] };
      const done = await askBackend(q, scope, { keepAlive: -1 });
      if (!done || !done.success || !done.answer) {
        t.textContent = textBackup;
        showRecordMessage('danger', `❌ ${(done && done.error) || 'Failed to regenerate (fallback)'}`);
      } else {
        const fullText = done.answer;
        trySaveTopicForRecord(__currentRecordId, fullText);
        t.textContent = fullText;
        showRecordMessage('info', 'ℹ️ Topic regenerated.');
      }
    }
  } catch (e) {
    t.textContent = textBackup;
    showRecordMessage('danger', `❌ ${e.message || 'Failed to regenerate topic'}`);
  } finally {
    btn.disabled = false;
  }
}

const regenBtnEl = document.getElementById('regenTopicBtn');
if (regenBtnEl) {
  regenBtnEl.addEventListener('click', regenerateTopicForCurrent);
}

function inlineConfirm(targetEl, message, onConfirm, onCancel) {
  targetEl.querySelectorAll('.inline-confirm-wrap').forEach(n => n.remove());
  const wrap = document.createElement('div');
  wrap.className = 'inline-confirm-wrap d-inline-flex align-items-center gap-2';
  wrap.innerHTML = `
    <span class="small text-muted">${message}</span>
    <button type="button" class="btn btn-sm btn-danger">Yes</button>
    <button type="button" class="btn btn-sm btn-secondary">No</button>
  `;
  const [yesBtn, noBtn] = wrap.querySelectorAll('button');
  yesBtn.addEventListener('click', () => { wrap.remove(); onConfirm?.(); });
  noBtn.addEventListener('click', () => { wrap.remove(); onCancel?.(); });
  targetEl.appendChild(wrap);
  yesBtn.focus();
}

// -------- Agents --------
const agentTemplatesData = [
  { name: "Agent Template", agents: ["Private Data", "Family Calendar", "Misplaced Items", "Relationships"] }
];

function loadAgentTemplates() {
  const container = document.getElementById("agentTemplates");
  if (!container) return;
  container.innerHTML = '';
  const ta = document.getElementById("templateAgents");
  if (ta) ta.classList.add("hidden");

  agentTemplatesData.forEach(template => {
    const div = document.createElement("div");
    div.className = "agent-template-folder";
    div.innerHTML = `<div style="font-size:28px;line-height:1">📁</div><div style="margin-top:8px;font-weight:600">${template.name}</div>`;
    div.onclick = () => showAgents(template);
    container.appendChild(div);
  });
}

function showAgents(template) {
  const templates = document.getElementById("agentTemplates");
  const agentsContainer = document.getElementById("templateAgents");
  const list = document.getElementById("agentsList");
  const nameSpan = document.getElementById("selectedTemplateName");
  if (!templates || !agentsContainer || !list || !nameSpan) return;

  templates.classList.add("hidden");
  nameSpan.textContent = template.name || 'Agent Template';
  list.innerHTML = '';
  (template.agents || []).forEach(agent => {
    const btn = document.createElement("button");
    btn.type = 'button';
    btn.className = "list-group-item list-group-item-action";
    btn.textContent = `🧠 ${agent}`;
    btn.onclick = () => { showAgentFeature(agent.toLowerCase().replace(/\s+/g, "")); };
    list.appendChild(btn);
  });
  agentsContainer.classList.remove("hidden");
  const af = document.getElementById("agentFeatureContent");
  if (af) af.textContent = "Select a feature to view its details.";
}

function backToTemplates() {
  const templates = document.getElementById("agentTemplates");
  const agentsContainer = document.getElementById("templateAgents");
  const af = document.getElementById("agentFeatureContent");
  if (!templates || !agentsContainer || !af) return;
  agentsContainer.classList.add("hidden");
  templates.classList.remove("hidden");
  af.textContent = "Select a feature to view its details.";
}

function showAgentFeature(feature) {
  const c = document.getElementById("agentFeatureContent");
  if (!c) return;
  const map = {
    private: "📄 Private Data Feature Coming Soon",
    calendar: "📅 Family Calendar Feature Coming Soon",
    misplaced: "🧳 Misplaced Items Feature Coming Soon",
    relationships: "👪 Relationships Feature Coming Soon"
  };
  const key = Object.keys(map).find(k => feature.includes(k)) || feature;
  c.textContent = map[key] || `Feature ${feature} coming soon.`;
}

// -------- Initialize --------
(function initFromNavigationFlag() {
  let initial = 'dashboard';
  try {
    const stored = localStorage.getItem('homeInitialSection');
    if (stored) {
      initial = stored;
      localStorage.removeItem('homeInitialSection');
    }
  } catch (_) {}
  showSection(initial);
})();

// --- Enable ENTER to submit question ---
const qInput = document.getElementById("questionInput");
if (qInput) {
  qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const askBtn = document.getElementById("askBtn");

      if (!askBtn.disabled) {
        const text = qInput.value;  // store before clearing
        qInput.value = "";          // <-- immediately clear textbox
        askQuestion(text);          // pass text manually
      }
    }
  });
}



loadAgentTemplates();
updateHeaderModeUI(); 
startOllamaWatch();
loadCurrentUser().then(async () => {
  updateHeaderModeUI();   // <-- Add this so banner updates immediately
  updateCollectionBadge();
  try { await runAutoSummaryAtStartup(); } catch (_) {}
  applyModelUIFromStorage();  // sets header + QA mode from stored value
  updateAskControlsUI();      // initial state based on doc + mode selection
});

// Debug helper
window.__fc = { showSection };
