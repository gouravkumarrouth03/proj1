export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export function authHeaders(user) {
  return user ? { 'X-User-ID': String(user.id), 'X-User-Role': user.role } : {};
}

export async function sendAuthHeartbeat(user) {
  const res = await fetch(`${API_BASE}/api/v1/auth/heartbeat`, {
    method: 'POST',
    headers: authHeaders(user),
  });
  if (!res.ok) throw new Error('Failed to update online presence');
  return res.json();
}

export async function fetchNotifications(user) {
  const res = await fetch(`${API_BASE}/api/v1/notifications`, { headers: authHeaders(user) });
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return res.json();
}

export async function markNotificationRead(notificationId, user) {
  const res = await fetch(`${API_BASE}/api/v1/notifications/${notificationId}/read`, {
    method: 'PATCH',
    headers: authHeaders(user),
  });
  if (!res.ok) throw new Error('Failed to mark notification as read');
  return res.json();
}

export async function loginUser(credentials) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
  } catch {
    throw new Error('Cannot connect to the backend. Check if backend is running on port 8000.');
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || 'Unable to sign in');
  }
  return res.json();
}

export async function registerUser(userData) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });
  } catch {
    throw new Error('Cannot connect to the backend.');
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to register account');
  }
  return res.json();
}

export async function fetchOverview() {
  const res = await fetch(`${API_BASE}/api/v1/analytics/overview`);
  if (!res.ok) throw new Error('Failed to fetch overview');
  return res.json();
}

export async function fetchProjects(limit = 200) {
  const res = await fetch(`${API_BASE}/api/v1/projects?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function deleteProject(projectId, user) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeaders(user),
  });
  if (!res.ok) throw new Error('Failed to delete project');
  return res.json();
}

export async function fetchAlerts() {
  const res = await fetch(`${API_BASE}/api/v1/predictions/alerts`);
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json();
}

export async function createProject(projectData) {
  const res = await fetch(`${API_BASE}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}

export async function predictProjectRisk(data) {
  const res = await fetch(`${API_BASE}/api/v1/predictions/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to predict project risk');
  return res.json();
}

export async function fetchUsers(user) {
  const res = await fetch(`${API_BASE}/api/v1/users`, { headers: authHeaders(user) });
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export async function createUser(userData, user) {
  const res = await fetch(`${API_BASE}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create user');
  }
  return res.json();
}

export async function deleteUser(userId, user) {
  const res = await fetch(`${API_BASE}/api/v1/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete user');
  }
  return res.json();
}

export async function fetchDatabaseStats(user) {
  const res = await fetch(`${API_BASE}/api/v1/database/stats`, { headers: authHeaders(user) });
  if (!res.ok) throw new Error('Failed to fetch database statistics');
  return res.json();
}

export async function fetchInspectors(user) {
  const res = await fetch(`${API_BASE}/api/v1/inspectors`, { headers: authHeaders(user) });
  if (!res.ok) throw new Error('Failed to fetch inspectors');
  return res.json();
}

export async function updateProjectStatus(projectId, data, user) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update project status');
  }
  return res.json();
}

export async function assignProjectInspector(projectId, inspectorName, inspectorId, user) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/assign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify({ assigned_inspector: inspectorName, assigned_inspector_id: inspectorId || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to assign inspector');
  }
  return res.json();
}

