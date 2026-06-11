const asyncHooks = require('async_hooks');

const contextStore = new Map();

const asyncLocalStorage = new asyncHooks.AsyncLocalStorage();

function getTenantContext() {
  const store = asyncLocalStorage.getStore();
  if (store && store.has('tenantContext')) {
    return store.get('tenantContext');
  }
  return null;
}

function setTenantContext(ctx) {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.set('tenantContext', ctx);
  } else {
    const newStore = new Map();
    newStore.set('tenantContext', ctx);
    asyncLocalStorage.enterWith(newStore);
  }
}

function clearTenantContext() {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.delete('tenantContext');
  }
}

function getCurrentTenantId() {
  const ctx = getTenantContext();
  return ctx ? ctx.tenantId : null;
}

function getCurrentTenant() {
  const ctx = getTenantContext();
  return ctx ? ctx.tenant : null;
}

function isSuperAdmin() {
  const ctx = getTenantContext();
  return ctx ? ctx.isSuperAdmin : false;
}

function getBypassTenantFilter() {
  const ctx = getTenantContext();
  return ctx ? ctx.bypassTenantFilter : false;
}

module.exports = {
  asyncLocalStorage,
  getTenantContext,
  setTenantContext,
  clearTenantContext,
  getCurrentTenantId,
  getCurrentTenant,
  isSuperAdmin,
  getBypassTenantFilter
};
