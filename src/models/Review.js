const { DataTypes } = require('sequelize');
const sequelize = require('../config'); // Sequelize instance

const Review = sequelize.define('Review', {
    customerName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    ratings: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            min: 1,
            max: 5,
        },
    },
    review: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '',
    },
    image: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue:''
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
}, {
    timestamps: false,
});

module.exports = Review;
