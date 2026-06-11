const ROLE_LEVELS = {
  viewer: 0,
  operator: 1,
  admin: 2,
  superadmin: 999
};

const VALID_ROLES = new Set(Object.keys(ROLE_LEVELS));
const SUPERADMIN_ROLE = 'superadmin';

function extractUser(req, res, next) {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const role = req.headers['x-user-role'] || 'viewer';
  req.user = {
    id: userId,
    role: VALID_ROLES.has(role) ? role : 'viewer'
  };
  next();
}

function requireRole(minRole) {
  const minLevel = ROLE_LEVELS[minRole] || 0;
  return (req, res, next) => {
    const userLevel = ROLE_LEVELS[req.user.role] || 0;
    if (userLevel >= minLevel) {
      return next();
    }
    return res.status(403).json({ error: '权限不足' });
  };
}

function requireSuperAdmin() {
  return (req, res, next) => {
    if (req.user && req.user.role === SUPERADMIN_ROLE) {
      return next();
    }
    return res.status(403).json({ error: '需要超级管理员权限' });
  };
}

module.exports = { extractUser, requireRole, requireSuperAdmin, ROLE_LEVELS, SUPERADMIN_ROLE };
