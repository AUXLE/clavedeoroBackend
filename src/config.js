const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize('clavedeoro_db', process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST || 'localhost',
  dialect: 'mysql',
  logging: false,
});

module.exports = sequelize;
