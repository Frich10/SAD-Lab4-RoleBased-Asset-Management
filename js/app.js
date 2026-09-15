let currentUser = null;
let currentProfile = null;
let currentView = "dashboard";

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");

window.addEventListener("DOMContentLoaded", async () => {
  wireAuthForm();
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    await afterLogin();
  }
});

function wireAuthForm() {
  document.getElementById("login-btn").addEventListener("click", handleLogin);
  document.getElementById("signup-btn").addEventListener("click", handleSignup);
  document.getElementById("toggle-mode").addEventListener("click", toggleAuthMode);
}

let isSignupMode = false;
function toggleAuthMode() {
  isSignupMode = !isSignupMode;
  document.getElementById("signup-name-field").classList.toggle("hidden", !isSignupMode);
  document.getElementById("login-btn").classList.toggle("hidden", isSignupMode);
  document.getElementById("signup-btn").classList.toggle("hidden", !isSignupMode);
  document.getElementById("auth-title").textContent = isSignupMode ? "Create Account" : "Sign In";
  document.getElementById("toggle-mode").textContent = isSignupMode
    ? "Already have an account? Sign in"
    : "New here? Create an account";
  document.getElementById("auth-error").textContent = "";
}

async function handleLogin() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  setAuthError("");
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setAuthError(error.message);
  currentUser = data.user;
  await afterLogin();
}

async function handleSignup() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const fullName = document.getElementById("auth-fullname").value.trim();
  setAuthError("");
  if (!fullName) return setAuthError("Full name is required.");
  const { data, error } = await supabaseClient.auth.signUp({
    email, password,
    options: { data: { full_name: fullName } }
  });
  if (error) return setAuthError(error.message);
  if (data.user && !data.session) {
    setAuthError("Account created. Check your email to confirm, then sign in.");
    return;
  }
  currentUser = data.user;
  await afterLogin();
}

function setAuthError(msg) {
  document.getElementById("auth-error").textContent = msg;
}

async function afterLogin() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  if (error || !data) {
    setAuthError("Could not load your profile. Try again in a moment.");
    return;
  }
  currentProfile = data;
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  buildSidebar();
  navigate("dashboard");
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentProfile = null;
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

const NAV_BY_ROLE = {
  admin:  [["dashboard","Dashboard"],["equipment","Equipment"],["approvals","Approvals"],
           ["operations","Release / Return"],["maintenance","Maintenance"],
           ["users","Users"],["audit","Audit Log"]],
  staff:  [["dashboard","Dashboard"],["equipment","Equipment"],
           ["operations","Release / Return"],["maintenance","Maintenance"]],
  requester: [["dashboard","Dashboard"],["equipment","Equipment"],["myrequests","My Requests"]],
};

function buildSidebar() {
  const nav = document.getElementById("sidebar");
  const links = NAV_BY_ROLE[currentProfile.role] || [];
  nav.innerHTML = `
    <div class="brand">Lab Asset System
      <div class="role-badge">${currentProfile.role}</div>
    </div>
    ${links.map(([key,label]) => `<a class="nav-link" data-view="${key}">${label}</a>`).join("")}
    <div class="logout-wrap">
      <div style="font-size:12px;color:#9ca3af;margin-bottom:8px;">${currentProfile.full_name}</div>
      <button class="btn secondary small" id="logout-btn">Log out</button>
    </div>
  `;
  nav.querySelectorAll(".nav-link").forEach(a =>
    a.addEventListener("click", () => navigate(a.dataset.view))
  );
  document.getElementById("logout-btn").addEventListener("click", handleLogout);
}

function markActiveNav() {
  document.querySelectorAll(".nav-link").forEach(a =>
    a.classList.toggle("active", a.dataset.view === currentView)
  );
}

async function navigate(view) {

  const allowed = (NAV_BY_ROLE[currentProfile.role] || []).some(([key]) => key === view);
  if (!allowed) {
    toast("Access denied for your role.");
    view = "dashboard";
  }
  currentView = view;
  markActiveNav();
  const map = {
    dashboard: renderDashboard,
    equipment: renderEquipment,
    myrequests: renderMyRequests,
    approvals: renderApprovals,
    operations: renderOperations,
    maintenance: renderMaintenance,
    users: renderUsers,
    audit: renderAuditLog,
  };
  await (map[view] || renderDashboard)();
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function content() { return document.getElementById("content"); }
function badge(status) { return `<span class="badge ${status.replace(/\s/g,'')}">${status}</span>`; }

async function renderDashboard() {
  const [{ count: eqCount }, { data: myTx }] = await Promise.all([
    supabaseClient.from("equipment").select("*", { count: "exact", head: true }),
    supabaseClient.from("borrowing_transactions").select("status")
  ]);
  const counts = {};
  (myTx || []).forEach(t => counts[t.status] = (counts[t.status]||0)+1);
  content().innerHTML = `
    <h2>Dashboard</h2>
    <p style="color:var(--muted)">Signed in as <b>${currentProfile.full_name}</b> (${currentProfile.role})</p>
    <div class="card">
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div><div style="font-size:26px;font-weight:700;">${eqCount ?? 0}</div><div style="color:var(--muted);font-size:13px;">Equipment items</div></div>
        ${Object.entries(counts).map(([k,v]) => `
          <div><div style="font-size:26px;font-weight:700;">${v}</div><div style="color:var(--muted);font-size:13px;">${k}</div></div>
        `).join("")}
      </div>
    </div>
    <div class="card">
      <h3>Your role's permissions</h3>
      ${roleDescription(currentProfile.role)}
    </div>
  `;
}

function roleDescription(role) {
  const desc = {
    admin: "Manage users and equipment; approve/reject requests; manage maintenance; view reports and audit logs.",
    staff: "View equipment; create borrowing transactions; process returns; submit maintenance requests; update permitted records.",
    requester: "View available equipment; submit borrowing requests; view your own request status and history."
  };
  return `<p style="font-size:14px;">${desc[role]}</p>`;
}

async function renderEquipment() {
  const { data: eq, error } = await supabaseClient.from("equipment").select("*").order("id");
  const canManage = currentProfile.role === "admin";
  content().innerHTML = `
    <h2>Equipment</h2>
    <div class="card">
      <div class="toolbar">
        <div></div>
        ${canManage ? `<button class="btn" id="add-eq-btn">+ Add Equipment</button>` : ""}
      </div>
      ${canManage ? `
      <div id="add-eq-form" class="hidden" style="margin-bottom:16px;padding:14px;background:#f9fafb;border-radius:8px;">
        <div class="field"><label>Name</label><input id="new-eq-name"></div>
        <div class="field"><label>Category</label><input id="new-eq-category"></div>
        <button class="btn small" id="save-eq-btn">Save</button>
      </div>` : ""}
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Status</th>
          ${currentProfile.role === "requester" ? "<th>Action</th>" : ""}
          ${canManage ? "<th>Manage</th>" : ""}
        </tr></thead>
        <tbody>
          ${(eq||[]).map(e => `
            <tr>
              <td>${e.id}</td><td>${e.name}</td><td>${e.category||"-"}</td><td>${badge(e.status)}</td>
              ${currentProfile.role === "requester" ? `<td>
                <button class="btn small ${e.status==='Available'?'':'secondary'}" ${e.status==='Available'?'':'disabled'}
                  onclick="quickRequest(${e.id})">Request</button>
              </td>` : ""}
              ${canManage ? `<td class="actions-cell">
                <button class="btn small danger" onclick="deleteEquipment(${e.id})">Delete</button>
              </td>` : ""}
            </tr>`).join("") || `<tr><td colspan="6" class="empty-note">No equipment yet.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  if (canManage) {
    document.getElementById("add-eq-btn").addEventListener("click", () =>
      document.getElementById("add-eq-form").classList.toggle("hidden"));
    document.getElementById("save-eq-btn").addEventListener("click", async () => {
      const name = document.getElementById("new-eq-name").value.trim();
      const category = document.getElementById("new-eq-category").value.trim();
      if (!name) return toast("Name is required.");
      const { error } = await supabaseClient.from("equipment").insert({ name, category });
      if (error) return toast(error.message);
      toast("Equipment added.");
      renderEquipment();
    });
  }
}

async function deleteEquipment(id) {
  if (!confirm("Delete this equipment item?")) return;
  const { error } = await supabaseClient.from("equipment").delete().eq("id", id);
  if (error) return toast(error.message);
  toast("Deleted.");
  renderEquipment();
}

async function quickRequest(equipmentId) {
  const purpose = prompt("Purpose of borrowing:");
  if (purpose === null) return;
  const { error } = await supabaseClient.from("borrowing_transactions").insert({
    equipment_id: equipmentId, requester_id: currentUser.id, purpose
  });
  if (error) return toast(error.message);
  toast("Request submitted (Pending).");
  renderEquipment();
}

async function renderMyRequests() {
  const { data } = await supabaseClient
    .from("borrowing_transactions")
    .select("*, equipment(name)")
    .eq("requester_id", currentUser.id)
    .order("request_date", { ascending: false });
  content().innerHTML = `
    <h2>My Requests</h2>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Equipment</th><th>Purpose</th><th>Status</th><th>Requested</th></tr></thead>
        <tbody>
          ${(data||[]).map(t => `
            <tr><td>${t.id}</td><td>${t.equipment?.name||t.equipment_id}</td><td>${t.purpose||"-"}</td>
              <td>${badge(t.status)}</td><td>${new Date(t.request_date).toLocaleString()}</td></tr>
          `).join("") || `<tr><td colspan="5" class="empty-note">You haven't submitted any requests yet.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function renderApprovals() {
  const { data } = await supabaseClient
    .from("borrowing_transactions")
    .select("*, equipment(name), requester:profiles!borrowing_transactions_requester_id_fkey(full_name)")
    .eq("status", "Pending")
    .order("request_date");
  content().innerHTML = `
    <h2>Pending Approvals</h2>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Equipment</th><th>Requester</th><th>Purpose</th><th>Requested</th><th>Action</th></tr></thead>
        <tbody>
          ${(data||[]).map(t => `
            <tr><td>${t.id}</td><td>${t.equipment?.name||t.equipment_id}</td>
              <td>${t.requester?.full_name||t.requester_id}</td><td>${t.purpose||"-"}</td>
              <td>${new Date(t.request_date).toLocaleString()}</td>
              <td class="actions-cell">
                <button class="btn small success" onclick="decideRequest(${t.id},'Approved')">Approve</button>
                <button class="btn small danger" onclick="decideRequest(${t.id},'Rejected')">Reject</button>
              </td></tr>
          `).join("") || `<tr><td colspan="6" class="empty-note">No pending requests.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function decideRequest(id, status) {
  const { error } = await supabaseClient.from("borrowing_transactions").update({ status }).eq("id", id);
  if (error) return toast(error.message);
  toast(`Request ${status}.`);
  renderApprovals();
}

async function renderOperations() {
  const { data } = await supabaseClient
    .from("borrowing_transactions")
    .select("*, equipment(name), requester:profiles!borrowing_transactions_requester_id_fkey(full_name)")
    .in("status", ["Approved","Released"])
    .order("request_date");
  content().innerHTML = `
    <h2>Release &amp; Return Processing</h2>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Equipment</th><th>Requester</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${(data||[]).map(t => `
            <tr><td>${t.id}</td><td>${t.equipment?.name||t.equipment_id}</td>
              <td>${t.requester?.full_name||t.requester_id}</td><td>${badge(t.status)}</td>
              <td class="actions-cell">
                ${t.status==='Approved' ? `<button class="btn small" onclick="releaseTx(${t.id})">Release</button>` : ""}
                ${t.status==='Released' ? `<button class="btn small" onclick="returnTx(${t.id})">Mark Returned</button>` : ""}
              </td></tr>
          `).join("") || `<tr><td colspan="5" class="empty-note">Nothing to release or return right now.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function releaseTx(id) {
  const { error } = await supabaseClient.from("borrowing_transactions").update({ status: "Released" }).eq("id", id);
  if (error) return toast(error.message);
  toast("Equipment released to borrower.");
  renderOperations();
}

async function returnTx(id) {
  const damaged = confirm("Was the equipment returned damaged?\nOK = Damaged, Cancel = Good condition");
  const { error } = await supabaseClient.from("borrowing_transactions")
    .update({ status: "Returned", is_damaged: damaged }).eq("id", id);
  if (error) return toast(error.message);
  toast("Return recorded.");
  renderOperations();
}

async function renderMaintenance() {
  const { data: eq } = await supabaseClient.from("equipment").select("id,name").order("name");
  const { data: reqs } = await supabaseClient
    .from("maintenance_requests")
    .select("*, equipment(name)")
    .order("created_at", { ascending: false });
  content().innerHTML = `
    <h2>Maintenance</h2>
    <div class="card">
      <div class="toolbar"><div></div><button class="btn" id="new-maint-btn">+ New Maintenance Request</button></div>
      <div id="new-maint-form" class="hidden" style="margin-bottom:16px;padding:14px;background:#f9fafb;border-radius:8px;">
        <div class="field"><label>Equipment</label>
          <select id="maint-eq">${(eq||[]).map(e=>`<option value="${e.id}">${e.name}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Description</label><textarea id="maint-desc" rows="2"></textarea></div>
        <button class="btn small" id="save-maint-btn">Submit</button>
      </div>
      <table>
        <thead><tr><th>ID</th><th>Equipment</th><th>Description</th><th>Status</th>
          ${currentProfile.role==='admin' ? "<th>Action</th>" : ""}</tr></thead>
        <tbody>
          ${(reqs||[]).map(r => `
            <tr><td>${r.id}</td><td>${r.equipment?.name||r.equipment_id}</td><td>${r.description}</td>
              <td>${badge(r.status.replace(/\s/g,''))}</td>
              ${currentProfile.role==='admin' && r.status!=='Resolved' ? `<td>
                <button class="btn small success" onclick="resolveMaintenance(${r.id})">Mark Resolved</button>
              </td>` : (currentProfile.role==='admin' ? "<td>-</td>" : "")}
            </tr>
          `).join("") || `<tr><td colspan="5" class="empty-note">No maintenance requests.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("new-maint-btn").addEventListener("click", () =>
    document.getElementById("new-maint-form").classList.toggle("hidden"));
  document.getElementById("save-maint-btn").addEventListener("click", async () => {
    const equipment_id = Number(document.getElementById("maint-eq").value);
    const description = document.getElementById("maint-desc").value.trim();
    if (!description) return toast("Description is required.");
    const { error } = await supabaseClient.from("maintenance_requests")
      .insert({ equipment_id, requested_by: currentUser.id, description });
    if (error) return toast(error.message);
    toast("Maintenance request submitted.");
    renderMaintenance();
  });
}

async function resolveMaintenance(id) {
  const { error } = await supabaseClient.from("maintenance_requests").update({ status: "Resolved" }).eq("id", id);
  if (error) return toast(error.message);
  toast("Marked resolved.");
  renderMaintenance();
}

async function renderUsers() {
  const { data } = await supabaseClient.from("profiles").select("*").order("full_name");
  content().innerHTML = `
    <h2>Users</h2>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Change Role</th></tr></thead>
        <tbody>
          ${(data||[]).map(u => `
            <tr><td>${u.full_name}</td><td>${u.email||"-"}</td><td>${badge(u.role)}</td>
              <td>
                <select onchange="changeRole('${u.id}', this.value)">
                  ${["requester","staff","admin"].map(r=>`<option value="${r}" ${r===u.role?'selected':''}>${r}</option>`).join("")}
                </select>
              </td></tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function changeRole(id, role) {
  const { error } = await supabaseClient.from("profiles").update({ role }).eq("id", id);
  if (error) return toast(error.message);
  toast("Role updated.");
}

async function renderAuditLog() {
  const { data, error } = await supabaseClient
    .from("audit_logs")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  content().innerHTML = `
    <h2>Audit Log</h2>
    <div class="card">
      <table>
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Description</th></tr></thead>
        <tbody>
          ${(data||[]).map(l => `
            <tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${l.profiles?.full_name||l.user_id||"system"}</td>
              <td>${l.action}</td><td>${l.module}</td><td>${l.record_id||"-"}</td><td>${l.description||"-"}</td></tr>
          `).join("") || `<tr><td colspan="6" class="empty-note">No audit entries ${error?("(error: "+error.message+")"):""}.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}
