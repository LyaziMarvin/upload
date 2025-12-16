// public/js/p2pClient.js

/* ============================= Config ============================= */
const DEFAULT_SERVER = 'http://184.168.29.119:5020';
const urlServer = new URLSearchParams(location.search).get('server');
const SERVER = (urlServer && urlServer.trim()) || DEFAULT_SERVER;
const API = SERVER;
const WS_URL = (() => {
  try { const u = new URL(SERVER); return (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host; }
  catch { return 'ws://184.168.29.119:5020'; }
})();

/* ============================= DOM ============================= */
// Account UI removed — SSO only
const groupNameEl = document.getElementById('groupName');
const createGroupBtn = document.getElementById('createGroupBtn');
const refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
const groupsList = document.getElementById('groupsList');

const selectedGroupNameEl = document.getElementById('selectedGroupName'); // hidden
const selectedGroupIdEl = document.getElementById('selectedGroupId');     // hidden
// joinGroupBtn removed

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

const inviteesList = document.getElementById('inviteesList');
const goInviteBtn = document.getElementById('goInviteBtn');
const oneGroupNote = document.getElementById('oneGroupNote');
const groupNameField = document.getElementById('groupNameField');




// NEW: Connect-with-users DOM
const connectionsList = document.getElementById('connectionsList');

/* ============================= State ============================= */
let currentUser = null;        // { id?: string, email: string, name: string }
let currentGroupId = null;
let currentGroupName = null;

let ws = null;
let authed = false;

let currentFileId = null;
let currentDocVersion = null;
let currentRole = 'viewer';

// NEW: Invite Users button → goes to Invite Users section
goInviteBtn?.addEventListener('click', () => {
  showSection('p2pInvites');
});


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
  const res = await fetch(url,{
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body||{})
  });

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const msg = (data && data.error) || res.statusText || 'Request failed';
    throw new Error(msg);
  }

  return data || {};
}

/* ============================= Groups UI ============================= */
function renderGroups(list){
  groupsList.innerHTML='';
  if(!list || list.length===0){
    groupsList.textContent='No groups yet.';
    return;
  }

  list.forEach(g => {
    const d = document.createElement('div');
    d.className = 'msg';
    d.dataset.groupName = g.name;

    // 🔥 AUTO-ACTIVE WORD ON PAGE LOAD
    if (!currentGroupId) {
      // If no active group stored, assume first one is active
      currentGroupId = g.id;
      currentGroupName = g.name;
      if (selectedGroupIdEl) selectedGroupIdEl.value = g.id;
      if (selectedGroupNameEl) selectedGroupNameEl.value = g.name;
    }

    // 🔥 If this group is the active one → show (Active) immediately
    if (g.id === currentGroupId) {
      d.classList.add('active-group');
      d.innerHTML =
        `<strong>${escapeHtml(g.name)}</strong> <span class="text-success">(Active)</span>`;
    } else {
      d.innerHTML = `<strong>${escapeHtml(g.name)}</strong>`;
    }

    d.onclick = () => {
      currentGroupId = g.id;
      currentGroupName = g.name;
      if (selectedGroupIdEl) selectedGroupIdEl.value = g.id;
      if (selectedGroupNameEl) selectedGroupNameEl.value = g.name;

      setStatus(`Using group ${g.name}`);
      showInline(`Using group “${g.name}”.`);

      // Remove active state
      document.querySelectorAll('#groupsList .msg').forEach(x => {
        x.classList.remove('active-group');
        x.innerHTML = `<strong>${escapeHtml(x.dataset.groupName)}</strong>`;
      });

      // Apply active state
      d.classList.add('active-group');
      d.innerHTML =
        `<strong>${escapeHtml(g.name)}</strong> <span class="text-success">(Active)</span>`;
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

/* ============================= Groups: Create ============================= */
createGroupBtn?.addEventListener('click', async ()=>{
  if(!currentUser?.id) return showInline('Please wait — connecting you to the server…');
  const name = groupNameEl.value.trim();
  if(!name) return showInline('Enter group name.');

  const done = setBusy(createGroupBtn, 'Creating…');
  try{
    const { group } = await postJSON(`${API}/api/group/create`, { userId: currentUser.id, name });

    // Set current group in state
    currentGroupId = group.id;
    currentGroupName = group.name;
    if (selectedGroupIdEl) selectedGroupIdEl.value = group.id;
    if (selectedGroupNameEl) selectedGroupNameEl.value = group.name;

    setStatus(`Using group ${group.name}`);
   showInline('Group created and selected.');
   if (oneGroupNote) oneGroupNote.style.display = 'block';
   if (groupNameField) groupNameField.style.display = 'none';
   if (goInviteBtn) goInviteBtn.style.display = 'block';




// NEW: Disable Create Group button now that a group exists
createGroupBtn.disabled = true;
createGroupBtn.classList.add('btn-secondary');
createGroupBtn.classList.remove('btn-primary');
createGroupBtn.textContent = "Group Already Created";

await refreshGroups();
await refreshFiles();
toggleShareButton();
if (typeof window.p2pRefreshInvitees === 'function') {
  window.p2pRefreshInvitees();
}

  }catch(e){
    showInline(`Create group failed: ${e.message}`);
  } finally {
    done();
  }
});

refreshGroupsBtn?.addEventListener('click', refreshGroups);

async function refreshGroups(){
  if(!currentUser?.id) return;
  try{
    const r = await fetch(`${API}/api/me/${currentUser.id}/groups`);
    const d = await r.json();
    const groups = d.groups || [];
    renderGroups(groups);

    // If user has exactly one group and none selected, auto-select it
    if (groups.length === 1 && !currentGroupId) {
      const g = groups[0];
      currentGroupId = g.id;
      currentGroupName = g.name;
      if (selectedGroupIdEl) selectedGroupIdEl.value = g.id;
      if (selectedGroupNameEl) selectedGroupNameEl.value = g.name;
      setStatus(`Using group ${g.name}`);
      await refreshFiles();
      toggleShareButton();
    }

    // NEW: Disable Create Group button if at least one group already exists
if (groups.length >= 1) {
  createGroupBtn.disabled = true;
  createGroupBtn.classList.add('btn-secondary');
  createGroupBtn.classList.remove('btn-primary');
  createGroupBtn.textContent = "Group Already Created";

  // MAKE INVITE BUTTON VISIBLE
  if (goInviteBtn) goInviteBtn.style.display = 'block';

  if (groupNameField) groupNameField.style.display = 'none';
  if (oneGroupNote) oneGroupNote.style.display = 'block';
}



  }catch(e){
    showInline(`Could not load groups: ${e.message}`);
  }
}

/* ============================= Files: list/open/save/permissions ============================= */
function toggleShareButton(){
  createSharedTextBtn.disabled = !(fileInput?.files?.[0] && shareNameEl.value.trim() && currentGroupId);
}
fileInput?.addEventListener('change', toggleShareButton);
shareNameEl?.addEventListener('input', toggleShareButton);

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

/* ============================= Invites (mirror only, no preview) ============================= */
(function setupGroupMirrors() {
  const selected = document.getElementById('selectedGroupId');
  const mirror = document.getElementById('inviteGroupIdMirror');
  const sync = () => { if (mirror && selected) mirror.value = selected.value; };
  selected?.addEventListener('input', sync);
  sync();
  setInterval(sync, 500);
})();

inviteExistingBtn?.addEventListener('click', async () => {
  if (!currentUser?.id) { showInline('Please wait — connecting you to the server…'); return; }
  const email = (inviteEmailEl.value || '').trim();
  const gid = currentGroupId;
  const gname = currentGroupName;
  if (!gid || !gname) { showInline('Create your group first before inviting.'); return; }
  if (!email) { showInline('Enter the invitee email.'); return; }

  const done = setBusy(inviteExistingBtn, 'Inviting…');
  try {
    const r = await postJSON(`${API}/api/group/invite-existing`, {
      fromUserId: currentUser.id,
      groupId: gid,
      targetEmail: email
    });
    if (r.error) { showInline(`Invite failed: ${r.error}`); return; }
    showInline('Invitation sent successfully.');
    if (typeof window.p2pRefreshInvitees === 'function') {
      window.p2pRefreshInvitees();
    }
  } catch (e) { showInline(`Invite failed: ${e.message || e}`); }
  finally { done(); }
});

inviteNewBtn?.addEventListener('click', async () => {
  if (!currentUser?.id) { showInline('Please wait — connecting you to the server…'); return; }
  const email = (inviteEmailEl.value || '').trim();
  const gid = currentGroupId;
  const gname = currentGroupName;
  if (!gid || !gname) { showInline('Create your group first before inviting.'); return; }
  if (!email) { showInline('Enter the invitee email.'); return; }

  const done = setBusy(inviteNewBtn, 'Inviting…');
  try {
    const r = await postJSON(`${API}/api/group/invite-email`, {
      fromUserId: currentUser.id,
      groupId: gid,
      email
    });
    if (r.error) { showInline(`Invite failed: ${r.error}`); return; }
    showInline('Invitation sent successfully.');
    if (typeof window.p2pRefreshInvitees === 'function') {
      window.p2pRefreshInvitees();
    }
  } catch (e) { showInline(`Invite failed: ${e.message || e}`); }
  finally { done(); }
});

/* ============================= People in group (members + invites) ============================= */
function renderInviteesView({ members = [], invites = [] }) {
  if (!inviteesList) return;
  inviteesList.innerHTML = '';

  if (members.length === 0 && invites.length === 0) {
    inviteesList.textContent = 'No members or pending invites yet.';
    return;
  }

  if (members.length) {
    const mTitle = document.createElement('div');
    mTitle.innerHTML = '<strong>Members:</strong>';
    inviteesList.appendChild(mTitle);

    members.forEach(m => {
      const row = document.createElement('div');
      row.className = 'msg';
      const joined = m.added_at ? new Date(m.added_at).toLocaleString() : '';
      row.innerHTML = `
        <span>${escapeHtml(m.name || m.email)}</span>
        <span class="text-muted"> — ${escapeHtml(m.email)}</span>
        ${joined ? `<small class="text-muted"> (joined ${joined})</small>` : ''}
      `;
      inviteesList.appendChild(row);
    });
  }

  if (invites.length) {
    const iTitle = document.createElement('div');
    iTitle.className = 'mt-2';
    iTitle.innerHTML = '<strong>Pending Invites:</strong>';
    inviteesList.appendChild(iTitle);

    invites.forEach(inv => {
      const row = document.createElement('div');
      row.className = 'msg';
      const when = inv.created_at ? new Date(inv.created_at).toLocaleString() : '';
      row.innerHTML = `
        <span>${escapeHtml(inv.email)}</span>
        ${when ? `<small class="text-muted"> (invited ${when})</small>` : ''}
      `;
      inviteesList.appendChild(row);
    });
  }
}

async function refreshInvitees() {
  if (!inviteesList) return;
  if (!currentUser?.id) {
    inviteesList.textContent = 'Not signed in.';
    return;
  }

  const gid = currentGroupId;
  if (!gid) {
    inviteesList.textContent = 'Create or be invited to a group first.';
    return;
  }

  try {
    const res = await fetch(`${API}/api/group/${gid}/people/${currentUser.id}`);
    const data = await res.json();

    if (!res.ok) {
      inviteesList.textContent = data.error || 'Could not load members.';
      return;
    }

    renderInviteesView(data);
  } catch (e) {
    inviteesList.textContent = `Error loading members: ${e.message}`;
  }
}

// expose to HTML showSection()
window.p2pRefreshInvitees = refreshInvitees;

/* ============================= Connect with Users (incoming invitations) ============================= */
function renderConnectionsView(incoming = []) {
  if (!connectionsList) return;
  connectionsList.innerHTML = '';

  if (!incoming.length) {
    connectionsList.textContent = 'No invitations yet.';
    return;
  }

  incoming.forEach(inv => {
    const row = document.createElement('div');
    row.className = 'msg';

    const groupName =
      inv.group_name || inv.groupName || 'Family Circle group';
    const fromName =
      inv.from_name || inv.fromName || inv.ownerName || inv.owner_email || inv.ownerEmail || 'Unknown member';
    const fromEmail =
      inv.from_email || inv.fromEmail || inv.owner_email || inv.ownerEmail || '';
    const when = inv.created_at ? new Date(inv.created_at).toLocaleString() : '';

    row.innerHTML = `
      <div>
        <strong>${escapeHtml(fromName)}</strong>
        ${fromEmail ? `<span class="text-muted"> &lt;${escapeHtml(fromEmail)}&gt;</span>` : ''}
      </div>
      <div class="small text-muted">
        Invited you to join: ${escapeHtml(groupName)}${when ? ` • ${when}` : ''}
      </div>
    `;
    connectionsList.appendChild(row);
  });
}

async function refreshConnections() {
  if (!connectionsList) return;
  if (!currentUser?.id) {
    connectionsList.textContent = 'Not signed in.';
    return;
  }

  try {
    const res = await fetch(`${API}/api/me/${currentUser.id}/invites`);
    const data = await res.json();

    if (!res.ok) {
      connectionsList.textContent = data.error || 'Could not load invitations.';
      return;
    }

    const incoming = data.incoming || data.invites || [];
    renderConnectionsView(incoming);
  } catch (e) {
    connectionsList.textContent = `Error loading invitations: ${e.message}`;
  }
}

window.p2pRefreshConnections = refreshConnections;

/* ============================= Share text (PDF/DOCX/Text) ============================= */
createSharedTextBtn?.addEventListener('click', async ()=>{
  if(!currentUser?.id) return showInline('Please wait — connecting you to the server…');
  if(!currentGroupId) return showInline('Create your group first.');
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
