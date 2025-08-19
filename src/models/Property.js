const { DataTypes } = require('sequelize');
const sequelize = require('../config'); // Sequelize instance

const Property = sequelize.define('Property', {
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    owner: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    price: {
        type: DataTypes.FLOAT,
        allowNull: false,
    },
    area: {
        type: DataTypes.FLOAT,
        allowNull: false,
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: ''
    },
    exactAddress: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: ''
    },
    bhkType: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '1'
    },
    amenities: {
        type: DataTypes.TEXT, 
        allowNull: true,
        defaultValue: ''
    },
    ratings: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0.0
    },
    reviews: {
        type: DataTypes.TEXT, 
        allowNull: true,
        defaultValue: ''
    },
    images: {
        type: DataTypes.TEXT, // to support multiline string
        allowNull: true
      },      
    location: {
        type: DataTypes.STRING, // Store location name instead of foreign key
        allowNull: false,
    },
});

module.exports = Property;
