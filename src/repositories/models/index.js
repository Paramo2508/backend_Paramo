const { DataTypes } = require('sequelize');

const { sequelize } = require('../../config/database');

const options = { underscored: true, timestamps: false };

const ImportRun = sequelize.define(
  'ImportRun',
  {
    dataset: { type: DataTypes.STRING(50), allowNull: false },
    sourceUrl: { type: DataTypes.TEXT, allowNull: false },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    finishedAt: DataTypes.DATE,
    sourceCount: DataTypes.INTEGER,
    importedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rejectedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'running' },
    details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  },
  { ...options, tableName: 'import_runs' }
);

const ImportRejection = sequelize.define(
  'ImportRejection',
  {
    importRunId: { type: DataTypes.INTEGER, allowNull: false },
    dataset: { type: DataTypes.STRING(50), allowNull: false },
    sourceId: DataTypes.TEXT,
    reason: { type: DataTypes.TEXT, allowNull: false },
    raw: DataTypes.JSONB,
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  },
  { ...options, tableName: 'import_rejections' }
);

const Building = sequelize.define(
  'Building',
  {
    source: { type: DataTypes.STRING(50), allowNull: false },
    sourceId: { type: DataTypes.TEXT, allowNull: false },
    heightM: { type: DataTypes.DOUBLE, allowNull: false },
    heightSource: { type: DataTypes.STRING(20), allowNull: false },
    heightSuspicious: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    floors: DataTypes.SMALLINT,
    geom: { type: DataTypes.GEOMETRY('MULTIPOLYGON', 4326), allowNull: false },
    importRunId: DataTypes.INTEGER
  },
  { ...options, tableName: 'buildings' }
);

const Tree = sequelize.define(
  'Tree',
  {
    source: { type: DataTypes.STRING(50), allowNull: false },
    sourceId: { type: DataTypes.TEXT, allowNull: false },
    species: DataTypes.TEXT,
    heightM: DataTypes.DOUBLE,
    crownDiameterM: DataTypes.DOUBLE,
    geom: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: false },
    importRunId: DataTypes.INTEGER
  },
  { ...options, tableName: 'trees' }
);

const StreetSegment = sequelize.define(
  'StreetSegment',
  {
    source: { type: DataTypes.STRING(50), allowNull: false },
    sourceId: { type: DataTypes.TEXT, allowNull: false },
    osmWayId: { type: DataTypes.BIGINT, allowNull: false },
    name: DataTypes.TEXT,
    highway: { type: DataTypes.STRING(50), allowNull: false },
    geom: { type: DataTypes.GEOMETRY('LINESTRING', 4326), allowNull: false },
    lengthM: { type: DataTypes.DOUBLE, allowNull: false },
    importRunId: DataTypes.INTEGER
  },
  { ...options, tableName: 'street_segments' }
);

const User = sequelize.define(
  'User',
  {
    name: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false },
    passwordHash: DataTypes.STRING(100),
    googleId: DataTypes.STRING(255)
  },
  { underscored: true, timestamps: true, tableName: 'users' }
);

ImportRun.hasMany(ImportRejection, { foreignKey: 'importRunId' });
ImportRejection.belongsTo(ImportRun, { foreignKey: 'importRunId' });

module.exports = { sequelize, ImportRun, ImportRejection, Building, Tree, StreetSegment, User };
