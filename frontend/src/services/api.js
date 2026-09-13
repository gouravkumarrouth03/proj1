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

export async function fetchCurrentUser(user) {
  const res = await fetch(`${API_BASE}/api/v1/auth/me`, { headers: { 'X-User-ID': String(user.id) } });
  if (!res.ok) throw new Error('Failed to refresh user session');
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

export async function fetchProjectBackups(user) {
  const res = await fetch(`${API_BASE}/api/v1/admin/project-backups`, { headers: authHeaders(user) });
  if (!res.ok) throw new Error('Failed to fetch project backups');
  return res.json();
}

export async function restoreProjectBackup(backupId, user) {
  const res = await fetch(`${API_BASE}/api/v1/admin/project-backups/${backupId}/restore`, {
    method: 'POST', headers: authHeaders(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to restore project backup');
  }
  return res.json();
}

export async function permanentlyDeleteProjectBackup(backupId, user) {
  const res = await fetch(`${API_BASE}/api/v1/admin/project-backups/${backupId}`, {
    method: 'DELETE', headers: authHeaders(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to permanently delete backup');
  }
  return res.json();
}

export async function fetchAlerts() {
  const res = await fetch(`${API_BASE}/api/v1/predictions/alerts`);
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json();
}

export async function fetchProjectComments(projectId) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/comments`);
  if (!res.ok) throw new Error('Failed to fetch project comments');
  return res.json();
}

export async function addProjectComment(projectId, comment, image, user) {
  const formData = new FormData();
  formData.append('comment', comment);
  formData.append('image', image);
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/comments`, {
    method: 'POST',
    headers: authHeaders(user),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to add project comment');
  }
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

export async function sendOfficerOtp(email, user) {
  const res = await fetch(`${API_BASE}/api/v1/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to send verification code');
  }
  return res.json();
}

export async function verifyOfficerOtp(email, otp, user) {
  const res = await fetch(`${API_BASE}/api/v1/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify({ email, otp }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to verify code');
  }
  return res.json();
}

export async function changePassword(data, user) {
  const res = await fetch(`${API_BASE}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to change password');
  }
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

export async function fetchProjectHistory(projectId, user, fromDate = '', toDate = '') {
  const params = new URLSearchParams();
  if (fromDate) params.set('from_date', fromDate);
  if (toDate) params.set('to_date', toDate);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/history${query}`, {
    headers: authHeaders(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch project history');
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

/** Re-run ML predictions for all projects and persist the updated scores. */
export async function refreshMlModel(user) {
  const res = await fetch(`${API_BASE}/api/v1/predictions/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to refresh ML model');
  }
  return res.json();
}

/**
 * Re-run the full XGBoost ML pipeline for a single project, optionally
 * passing revised field values from the inspector update form so the scores
 * reflect the updated data before it is formally saved.
 *
 * @param {string} projectId
 * @param {{ revised_cost?, expenditure?, physical_progress?, revised_completion_date? }} overrides
 * @param {object} user – current auth user
 */
export async function repredictProject(projectId, overrides, user) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/repredict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
    body: JSON.stringify(overrides),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to run ML prediction');
  }
  return res.json();
}

/** Re-run ML predictions for all projects assigned to the current inspector officer. */
export async function repredictAssignedProjects(user) {
  const res = await fetch(`${API_BASE}/api/v1/inspector/repredict-assigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to re-predict assigned projects');
  }
  return res.json();
}

export async function fetchAdminAccessStatus(user) {
  const res = await fetch(`${API_BASE}/api/v1/users/request-admin/status`, {
    headers: authHeaders(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch access request status');
  }
  return res.json();
}

export async function requestAdminAccess(user) {
  const res = await fetch(`${API_BASE}/api/v1/users/request-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to request admin access');
  }
  return res.json();
}

export async function fetchAccessRequests(user) {
  const res = await fetch(`${API_BASE}/api/v1/admin/access-requests`, {
    headers: authHeaders(user),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch access requests');
  }
  return res.json();
}

export async function approveAccessRequest(requestId, user) {
  const res = await fetch(`${API_BASE}/api/v1/admin/access-requests/${requestId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to approve request');
  }
  return res.json();
}

export async function rejectAccessRequest(requestId, user) {
  const res = await fetch(`${API_BASE}/api/v1/admin/access-requests/${requestId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to reject request');
  }
  return res.json();
}
