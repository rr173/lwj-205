const ROLE_LEVELS = {
  viewer: 0,
  operator: 1,
  admin: 2
};

const VALID_ROLES = new Set(Object.keys(ROLE_LEVELS));

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

module.exports = { extractUser, requireRole, ROLE_LEVELS };
