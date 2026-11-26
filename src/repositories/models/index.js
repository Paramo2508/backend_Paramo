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
    googleId: DataTypes.STRING(255),
    tutorialStatus: DataTypes.STRING(10)
  },
  { underscored: true, timestamps: true, tableName: 'users' }
);

// PBI-18 (ADR-036): the simple route preferences of each user. The tables of the saved routes
// (route_profiles and users.route_profiles_seeded) are no longer used and have no model.
const RoutePreference = sequelize.define(
  'RoutePreference',
  {
    userId: { type: DataTypes.INTEGER, primaryKey: true },
    sunShade: { type: DataTypes.STRING(5), allowNull: false },
    avoidWind: { type: DataTypes.BOOLEAN, allowNull: false },
    preferParks: { type: DataTypes.BOOLEAN, allowNull: false },
    extraMinutes: { type: DataTypes.SMALLINT, allowNull: false },
    byWeather: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  },
  { ...options, tableName: 'route_preferences' }
);

const tripColumns = {
  userId: { type: DataTypes.INTEGER, allowNull: false },
  originLat: { type: DataTypes.DOUBLE, allowNull: false },
  originLng: { type: DataTypes.DOUBLE, allowNull: false },
  originLabel: DataTypes.STRING(200),
  destinationLat: { type: DataTypes.DOUBLE, allowNull: false },
  destinationLng: { type: DataTypes.DOUBLE, allowNull: false },
  destinationLabel: DataTypes.STRING(200)
};

// PBI-12: favourite trips of each user. The table route_searches (the old history of trips) is no
// longer used (#180) and has no model.
const RouteFavorite = sequelize.define(
  'RouteFavorite',
  {
    ...tripColumns,
    name: { type: DataTypes.STRING(60), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  },
  { ...options, tableName: 'route_favorites' }
);

// #180 (changes PBI-12): the places used recently as origin or destination.
const RecentPlace = sequelize.define(
  'RecentPlace',
  {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    label: DataTypes.STRING(200),
    usedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  },
  { ...options, tableName: 'recent_places' }
);

ImportRun.hasMany(ImportRejection, { foreignKey: 'importRunId' });
ImportRejection.belongsTo(ImportRun, { foreignKey: 'importRunId' });

module.exports = {
  sequelize,
  ImportRun,
  ImportRejection,
  Building,
  Tree,
  StreetSegment,
  User,
  RoutePreference,
  RouteFavorite,
  RecentPlace
};
