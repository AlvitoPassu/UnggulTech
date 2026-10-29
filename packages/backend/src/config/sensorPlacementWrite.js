// Backend environment only. Unknown, empty and missing values always fail closed.
// No request value, frontend setting or NODE_ENV can enable placement writes.
export const isSensorPlacementWriteEnabled = () => process.env.SENSOR_PLACEMENT_WRITE_ENABLED === "true";
