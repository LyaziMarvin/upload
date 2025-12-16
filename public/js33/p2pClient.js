/* ============================= Config ============================= */
const DEFAULT_SERVER = 'http://localhost:5020';
const urlServer = new URLSearchParams(location.search).get('server');
const SERVER = (urlServer && urlServer.trim()) || DEFAULT_SERVER;
const API = SERVER;
const WS_URL = (() => {
  try { const u = new URL(SERVER); return (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host; }
  catch { return 'ws://localhost:5020'; }
})();

/* ============================= DOM ============================= */
// Account UI removed — SSO only
const groupNameEl = document.getElementById('groupName');
const createGroupBtn = document.getElementById('createGroupBtn');
const refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
const groupsList = document.getElementById('groupsList');

const selectedGroupNameEl = document.getElementById('selectedGroupName');
const selectedGroupIdEl = document.getElementById('selectedGroupId');
const joinGroupBtn = document.getElementById('joinGroupBtn');

const inviteEmailEl = document.getElementById('inviteEmail');
const inviteExistingBtn = document.getElementById('inviteExistingBtn');
const inviteNewBtn = document.getElementById('inviteNewBtn');

const statusEl = document.getElementById('status');
const inlineMsg = document.getElementById('inlineMsg');

const fileInput = document.getElementById('fileInput');
const shareNameEl = document.getElementById('shareName');
const createSharedTextBtn = document.getElementById('createSharedTextBtn');

const filesList = document.getElementById('filesList');
const permEmailEl = document.getElementById('permEmail');
const permRoleEl = document.getElementById('permRole');
const setPermBtn = document.getElementById('setPermBtn');
const docArea = document.getElementById('docArea');
const saveDocBtn = document.getElementById('saveDocBtn');

/* Invite Preview DOM */
const invitePreview = document.getElementById('invitePreview');
const invitePreviewStatus = document.getElementById('invitePreviewStatus');
const inviteDownloadUrl = document.getElementById('inviteDownloadUrl');
const inviteGroupName = document.getElementById('inviteGroupName');
const inviteGroupId = document.getElementById('inviteGroupId');
const inviteOwnerName = document.getElementById('inviteOwnerName');
const copyDownloadUrlBtn = document.getElementById('copyDownloadUrlBtn');
const copyGroupNameBtn = document.getElementById('copyGroupNameBtn');
const copyGroupIdBtn = document.getElementById('copyGroupIdBtn');
const copyOwnerNameBtn = document.getElementById('copyOwnerNameBtn');

/* ============================= State ============================= */
let currentUser = null;        // { id?: string, email: string, name: string }
let currentGroupId = null;
let currentGroupName = null;

let ws = null;
let authed = false;

let currentFileId = null;
let currentDocVersion = null;
let currentRole = 'viewer';

/* ============================= Helpers ============================= */
function setStatus(t){ if(statusEl) statusEl.textContent = t; console.log('[STATUS]', t); }
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" }[m])); }
let msgHideTimer = null;
function showInline(text){
  if(!inlineMsg) return console.log('[NOTICE]', text);
  inlineMsg.textContent = text;
  inlineMsg.classList.remove('d-none','hidden');
  clearTimeout(msgHideTimer);
  msgHideTimer = setTimeout(()=> inlineMsg.classList.add('d-none'), 5000);
}
function setBusy(btn, busyText) {
  if (!btn) return () => {};
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText || 'Working…';
  return () => { btn.disabled = false; btn.textContent = orig; };
}

/* ============================= REST ============================= */
async function postJSON(url, body){
  const res = await fetch(url,{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body||{}) });
  if(!res.ok){ const t=await res.text().catch(()=>String(res.status)); throw new Error(t || 'Request failed'); }
  return res.json();
}

/* ============================= Groups UI ============================= */
function renderGroups(list){
  groupsList.innerHTML='';
  if(!list || list.length===0){ groupsList.textContent='No groups yet.'; return; }
  list.forEach(g=>{
    const d=document.createElement('div');
    d.className='msg';
    d.innerHTML = `<strong>${escapeHtml(g.name)}</strong> — <code>${g.id}</code>`;
    d.onclick=()=>{
      selectedGroupIdEl.value = g.id;
      if (selectedGroupNameEl) selectedGroupNameEl.value = g.name;
      currentGroupName = g.name;
      clearInvitePreview();
    };
    groupsList.appendChild(d);
  });
}

/* ============================= SSO bootstrap (from main app) ============================= */
async function bootstrapFromMainApp() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No session token. Please sign in from the main app.');
  const res = await window.api.getCurrentUser(token);
  if (!res?.success || !res.data?.email) throw new Error(res?.error || 'Not authenticated');

  const localUser = res.data; // { email, name, ... }
  currentUser = {
    // id will be assigned after WS auth-ok
    email: localUser.email,
    name: localUser.name || localUser.email
  };
  localStorage.setItem('user', JSON.stringify(currentUser));
  setStatus(`Signed in as ${currentUser.name} (${currentUser.email})`);
}

/* ============================= WebSocket for doc sync ============================= */
function connectWS(){
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    setStatus('WebSocket connected.');
    authed=false;
    if(currentUser){
      // Send either known userId or (email,name) for server auto-create
      ws.send(JSON.stringify({ type:'auth', userId: currentUser.id, email: currentUser.email, name: currentUser.name }));
    }
  };
  ws.onclose = () => { setStatus('WebSocket disconnected.'); authed=false; };
  ws.onerror = (e) => { console.error('WS error', e); setStatus('WebSocket error.'); };
  ws.onmessage = (ev) => {
    let msg; try{ msg = JSON.parse(ev.data);}catch{ return; }
    switch(msg.type){
      case 'auth-ok':
        authed=true;
        // adopt server’s canonical identity (critical for later REST calls)
        currentUser = {
          id: msg.userId,
          email: msg.email || currentUser?.email,
          name: msg.name || currentUser?.name
        };
        localStorage.setItem('user', JSON.stringify(currentUser));
        setStatus(`Authenticated with server as ${currentUser.name}`);
        break;
      case 'auth-error':
        authed=false;
        setStatus(`Auth failed: ${msg.reason||'unknown'}`);
        showInline(`Auth failed: ${msg.reason||'unknown'}`);
        break;
      case 'doc-snapshot':
        if (msg.fileId !== currentFileId) break;
        docArea.value = msg.text || '';
        currentDocVersion = msg.version;
        currentRole = msg.role || 'viewer';
        setEditorEnabled(currentRole === 'editor');
        showInline(`Opened document (v${currentDocVersion}).`);
        break;
      case 'doc-update':
        if (msg.fileId !== currentFileId) break;
        docArea.value = msg.text || '';
        currentDocVersion = msg.version;
        break;
      case 'doc-conflict':
        if (msg.fileId !== currentFileId) break;
        docArea.value = msg.serverText || '';
        currentDocVersion = msg.serverVersion;
        showInline('Your copy was out of date. We refreshed to the latest version.');
        break;
      case 'doc-error':
        console.warn('Doc error:', msg.reason);
        showInline(msg.reason || 'Document error.');
        break;
    }
  };
}
async function ensureWSAuthed(){
  if(!ws || ws.readyState !== WebSocket.OPEN){
    connectWS();
    await new Promise(res=>{
      if (!ws) return res();
      if (ws.readyState === WebSocket.OPEN) return res();
      ws.addEventListener('open', res, { once:true });
    });
  }
  if(!authed && currentUser){
    ws.send(JSON.stringify({ type:'auth', userId: currentUser.id, email: currentUser.email, name: currentUser.name }));
    await new Promise((res, rej)=>{
      const onMsg = (ev)=>{
        let m; try{ m = JSON.parse(ev.data);}catch{ return; }
        if(m.type==='auth-ok'){
          ws.removeEventListener('message', onMsg);
          authed=true;
          // adopt identity again in case this path was taken
          currentUser = { id: m.userId, email: m.email || currentUser.email, name: m.name || currentUser.name };
          localStorage.setItem('user', JSON.stringify(currentUser));
          res();
        }
        if(m.type==='auth-error'){ ws.removeEventListener('message', onMsg); rej(new Error(m.reason||'auth-error')); }
      };
      ws.addEventListener('message', onMsg);
      setTimeout(()=>{ ws.removeEventListener('message', onMsg); if(!authed) rej(new Error('auth timeout')); }, 5000);
    }).catch(e=> showInline(`Auth error: ${e.message}`));
  }
}

/* ============================= Groups: Create + Join ============================= */
createGroupBtn?.addEventListener('click', async ()=>{
  if(!currentUser?.id) return showInline('Please wait — connecting you to the server…');
  const name=groupNameEl.value.trim(); if(!name) return showInline('Enter group name.');
  const done = setBusy(createGroupBtn, 'Creating…');
  try{
    const { group } = await postJSON(`${API}/api/group/create`, { userId: currentUser.id, name });
    selectedGroupIdEl.value = group.id;
    if (selectedGroupNameEl) selectedGroupNameEl.value = group.name;
    currentGroupName = group.name;
    showInline('Group created.');
    await refreshGroups();
  }catch(e){ showInline(`Create group failed: ${e.message}`); }
  finally { done(); }
});

refreshGroupsBtn?.addEventListener('click', refreshGroups);

async function refreshGroups(){
  if(!currentUser?.id) return;
  try{
    const r = await fetch(`${API}/api/me/${currentUser.id}/groups`);
    const d = await r.json();
    renderGroups(d.groups||[]);
  }catch(e){ showInline(`Could not load groups: ${e.message}`); }
}

joinGroupBtn?.addEventListener('click', async ()=>{
  if(!currentUser?.id) return showInline('Please wait — connecting you to the server…');
  const gid = (selectedGroupIdEl.value || '').trim();
  const gname = (selectedGroupNameEl?.value || '').trim();
  if(!gname) return showInline('Select a group by clicking its name first.');
  if(!gid)   return showInline('Enter or select a group ID.');
  currentGroupId = gid;
  currentGroupName = gname;
  setStatus(`Using group ${gname} (${gid})`);
  showInline(`Joined group “${gname}”.`);
  await refreshFiles();
  toggleShareButton();
});

function toggleShareButton(){
  createSharedTextBtn.disabled = !(fileInput?.files?.[0] && shareNameEl.value.trim() && currentGroupId);
}
fileInput?.addEventListener('change', toggleShareButton);
shareNameEl?.addEventListener('input', toggleShareButton);

/* ============================= Files: list/open/save/permissions ============================= */
function setEditorEnabled(canEdit){
  docArea.readOnly = !canEdit;
  saveDocBtn.disabled = !canEdit || !currentFileId;
  setPermBtn.disabled = !currentFileId;
}
async function refreshFiles(){
  if(!currentUser?.id || !currentGroupId) return;
  try{
    const r = await fetch(`${API}/api/group/${currentGroupId}/files/${currentUser.id}`);
    const d = await r.json();
    renderFiles(d.files||[]);
  }catch(e){ showInline(`Could not load files: ${e.message}`); }
}
function renderFiles(files){
  filesList.innerHTML = '';
  if(!files || files.length===0){ filesList.textContent = 'No shared files yet.'; return; }
  files.forEach(f=>{
    const d = document.createElement('div');
    d.className='msg';
    d.innerHTML = `<strong>${escapeHtml(f.name)}</strong> — <code>${f.id}</code>`;
    d.onclick = ()=> openFile(f.id);
    filesList.appendChild(d);
  });
}
async function openFile(fileId){
  if(!currentUser?.id) return;
  try{
    const snapRes = await fetch(`${API}/api/file/${fileId}/snapshot/${currentUser.id}`);
    const snap = await snapRes.json();
    if(snap.error){ showInline(snap.error); return; }
    currentFileId = fileId;
    docArea.value = snap.text || '';
    currentDocVersion = snap.version;
    currentRole = snap.role || 'viewer';
    setEditorEnabled(currentRole === 'editor');
    showInline('Document opened.');
    await subscribeToDoc(fileId);
  }catch(e){ showInline(`Open failed: ${e.message}`); }
}
async function subscribeToDoc(fileId){
  await ensureWSAuthed();
  ws.send(JSON.stringify({ type:'doc-subscribe', fileId }));
}
saveDocBtn?.addEventListener('click', async ()=>{
  if(!currentFileId) return;
  if(currentRole !== 'editor') return showInline('You have view-only access.');
  await ensureWSAuthed();
  ws.send(JSON.stringify({ type:'doc-edit', fileId: currentFileId, baseVersion: currentDocVersion, newText: docArea.value }));
  showInline('Saving…');
});
setPermBtn?.addEventListener('click', async ()=>{
  if(!currentFileId) return;
  if(!currentUser?.id) return showInline('Please wait — connecting you to the server…');
  const email = (permEmailEl.value || '').trim(); if(!email) return showInline('Enter email.');
  const role = permRoleEl.value;
  try {
    const r = await postJSON(`${API}/api/file/${currentFileId}/permission`, { fromUserId: currentUser.id, targetEmail: email, role });
    if(r.ok) showInline('Permission updated.');
    else showInline('Could not update permission.');
  } catch (e) {
    showInline('Error: ' + (e.message || e));
  }
});

/* ============================= Invites (mirror + preview) ============================= */
(function setupGroupMirrors() {
  const selected = document.getElementById('selectedGroupId');
  const mirror = document.getElementById('inviteGroupIdMirror');
  const sync = () => { if (mirror && selected) mirror.value = selected.value; };
  selected?.addEventListener('input', sync);
  sync();
  setInterval(sync, 500);
})();
function clearInvitePreview(){
  if (!invitePreview) return;
  invitePreview.classList.add('d-none');
  if (inviteDownloadUrl) inviteDownloadUrl.value = '';
  if (inviteGroupName)   inviteGroupName.value   = '';
  if (inviteGroupId)     inviteGroupId.value     = '';
  if (inviteOwnerName)   inviteOwnerName.value   = '';
  if (invitePreviewStatus) invitePreviewStatus.textContent = '';
}
function showInvitePreview({ downloadUrl, instructions }) {
  if (!invitePreview) return;
  const { groupName, groupId, ownerName } = instructions || {};
  if (inviteDownloadUrl) inviteDownloadUrl.value = downloadUrl || '';
  if (inviteGroupName)   inviteGroupName.value   = groupName || '';
  if (inviteGroupId)     inviteGroupId.value     = groupId || '';
  if (inviteOwnerName)   inviteOwnerName.value   = ownerName || '';
  invitePreview.classList.remove('d-none','hidden');
  if (invitePreviewStatus) {
    const when = new Date().toLocaleTimeString();
    invitePreviewStatus.textContent = `Generated ${when}`;
  }
}
async function copyTextFrom(el, statusEl) {
  try {
    const val = typeof el === 'string' ? el : (el?.value ?? '');
    await navigator.clipboard.writeText(val);
    if (statusEl) { statusEl.textContent = 'Copied!'; setTimeout(()=> statusEl.textContent = '', 2000); }
    showInline('Copied to clipboard.');
  } catch {
    showInline('Copy not available. Select and copy manually.');
  }
}
copyDownloadUrlBtn?.addEventListener('click', ()=> copyTextFrom(inviteDownloadUrl, invitePreviewStatus));
copyGroupNameBtn?.addEventListener('click',   ()=> copyTextFrom(inviteGroupName,   invitePreviewStatus));
copyGroupIdBtn?.addEventListener('click',     ()=> copyTextFrom(inviteGroupId,     invitePreviewStatus));
copyOwnerNameBtn?.addEventListener('click',   ()=> copyTextFrom(inviteOwnerName,   invitePreviewStatus));

inviteExistingBtn?.addEventListener('click', async () => {
  if (!currentUser?.id) { showInline('Please wait — connecting you to the server…'); return; }
  const email = (inviteEmailEl.value || '').trim();
  const gid = (selectedGroupIdEl.value || '').trim();
  const gname = (selectedGroupNameEl?.value || '').trim();
  if (!gname) { showInline('Select a group by clicking its name first.'); return; }
  if (!gid) { showInline('Choose a group ID (Join Group on the Groups tab).'); return; }
  if (!email) { showInline('Enter the invitee email.'); return; }

  const done = setBusy(inviteExistingBtn, 'Inviting…');
  try {
    const r = await postJSON(`${API}/api/group/invite-existing`, {
      fromUserId: currentUser.id,
      groupId: gid,
      targetEmail: email
    });
    if (r.error) { showInline(`Invite failed: ${r.error}`); return; }
    showInvitePreview(r);
    showInline('Invitation sent. Share the download link and codes below.');
  } catch (e) { showInline(`Invite failed: ${e.message || e}`); }
  finally { done(); }
});

inviteNewBtn?.addEventListener('click', async () => {
  if (!currentUser?.id) { showInline('Please wait — connecting you to the server…'); return; }
  const email = (inviteEmailEl.value || '').trim();
  const gid = (selectedGroupIdEl.value || '').trim();
  const gname = (selectedGroupNameEl?.value || '').trim();
  if (!gname) { showInline('Select a group by clicking its name first.'); return; }
  if (!gid) { showInline('Choose a group ID (Join Group on the Groups tab).'); return; }
  if (!email) { showInline('Enter the invitee email.'); return; }

  const done = setBusy(inviteNewBtn, 'Inviting…');
  try {
    const r = await postJSON(`${API}/api/group/invite-email`, {
      fromUserId: currentUser.id,
      groupId: gid,
      email
    });
    if (r.error) { showInline(`Invite failed: ${r.error}`); return; }
    showInvitePreview(r);
    showInline('Invitation sent. Share the download link and codes below.');
  } catch (e) { showInline(`Invite failed: ${e.message || e}`); }
  finally { done(); }
});

/* ============================= Share text (PDF/DOCX/Text) ============================= */
createSharedTextBtn?.addEventListener('click', async ()=>{
  if(!currentUser?.id) return showInline('Please wait — connecting you to the server…');
  if(!currentGroupId) return showInline('Select a group first');
  const f = fileInput.files?.[0]; if(!f) return showInline('Choose a file.');
  const name = shareNameEl.value.trim() || f.name;

  const done = setBusy(createSharedTextBtn, 'Uploading…');
  try{
    const fd = new FormData();
    fd.append('file', f);
    fd.append('userId', currentUser.id);
    fd.append('groupId', currentGroupId);
    fd.append('name', name);

    const res = await fetch(`${API}/api/files/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if(!res.ok || data.error){ throw new Error(data.error || 'Upload failed'); }

    await refreshFiles();
    currentFileId = data.file.id;
    showInline('File shared. Opening…');
    await subscribeToDoc(currentFileId);
  }catch(e){ showInline(`Share failed: ${e.message}`); }
  finally { done(); }
});

/* ============================= Bootstrap & WS ============================= */
(function showServerBadge() {
  const b = document.getElementById('serverBadge');
  if (!b) return;
  const params = new URLSearchParams(location.search);
  const server = params.get('server') || DEFAULT_SERVER;
  b.textContent = `Server: ${server}`;
  b.hidden = false;
})();

async function boot() {
  try {
    await bootstrapFromMainApp(); // sets currentUser.email/name
    await ensureWSAuthed();       // obtains server userId via auth-ok
    await refreshGroups();        // now safe to hit REST with userId
  } catch (e) {
    console.warn('[SSO] failed:', e.message);
    showInline('Not signed in. Please open the main app and sign in first.');
    try { window.api?.navigateTo?.('login.html'); } catch (_) {}
  }
}

// default landing
boot();
