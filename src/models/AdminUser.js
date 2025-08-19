// src/models/AdminUser.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config'); // this is the instance from above

const AdminUser = sequelize.define('AdminUser', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
});

module.exports = AdminUser;
