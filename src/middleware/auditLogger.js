const auditService = require('../services/auditService');

function audit(action, targetType, options) {
  const { model, idParam } = options || {};

  return async (req, res, next) => {
    let beforeValue = null;

    if (model && idParam && req.params[idParam]) {
      try {
        const record = await model.findByPk(req.params[idParam]);
        if (record) {
          beforeValue = record.toJSON();
        }
      } catch (e) {}
    }

    const originalJson = res.json.bind(res);

    res.json = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const targetId = idParam
          ? req.params[idParam]
          : (data && data.id) || null;

        const afterValue = (data && typeof data.toJSON === 'function')
          ? data.toJSON()
          : data;

        setImmediate(() => {
          auditService.record({
            operator: req.user ? req.user.id : 'anonymous',
            role: req.user ? req.user.role : 'viewer',
            action,
            targetType,
            targetId: targetId || null,
            beforeValue,
            afterValue,
            ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
          }).catch(err => {
            console.error('Audit log write failed:', err.message);
          });
        });
      }

      return originalJson(data);
    };

    next();
  };
}

module.exports = audit;
