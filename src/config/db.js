require('dotenv').config();
const { Sequelize } = require('sequelize');

// NODE_ENV=test / DB_DIALECT=sqlite lets the test suite run against an
// in-memory DB with zero setup. Production always uses MySQL — see
// .env.example. Never let DB_DIALECT=sqlite leak into a non-test run.
const useSqlite = process.env.DB_DIALECT === 'sqlite';

const sequelize = useSqlite
  ? new Sequelize({
      dialect: 'sqlite',
      storage: process.env.DB_STORAGE || ':memory:',
      logging: false,
    })
  : new Sequelize(
      process.env.DB_NAME || 'sp3digital_appointments',
      process.env.DB_USER || 'root',
      process.env.DB_PASSWORD || '',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        logging: false,
        pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
      },
    );

module.exports = sequelize;
