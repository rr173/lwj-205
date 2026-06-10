const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data/database.sqlite'),
  logging: false,
  pool: {
    max: 1,
    min: 0,
    acquire: 60000,
    idle: 10000
  },
  dialectOptions: {
    busyTimeout: 30000
  }
});

sequelize.afterConnect(async (conn) => {
  await conn.run('PRAGMA journal_mode=WAL;');
  await conn.run('PRAGMA busy_timeout=30000;');
  await conn.run('PRAGMA synchronous=NORMAL;');
  await conn.run('PRAGMA cache_size=-64000;');
  await conn.run('PRAGMA foreign_keys=ON;');
});

module.exports = sequelize;
