/**
 * 地理计算小工具（不引第三方库）
 */

const EARTH_RADIUS = 6371000; // 米

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * 计算两点间距离（米），Haversine 公式
 */
function distance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

/**
 * 距离格式化：500 米以内显示米，超过显示公里
 */
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} 米`;
  }
  return `${(meters / 1000).toFixed(1)} 公里`;
}

module.exports = {
  distance,
  formatDistance
};
