/**
 * 城市列表：小程序目前支持长株潭三城
 * center/scale 是每个城市打开时的默认视野
 */
const CITIES = [
  { id: 'xiangtan', name: '湘潭', center: { latitude: 27.852, longitude: 112.915 }, scale: 12.5 },
  { id: 'changsha', name: '长沙', center: { latitude: 28.185, longitude: 112.982 }, scale: 11.5 },
  { id: 'zhuzhou', name: '株洲', center: { latitude: 27.828, longitude: 113.115 }, scale: 12.5 }
];

const CITY_MAP = {};
CITIES.forEach((c) => {
  CITY_MAP[c.id] = c;
});

module.exports = { CITIES, CITY_MAP };
