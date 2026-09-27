export type DemoNoiseCell = {
  grid_cell_id: string;
  grid_latitude: number;
  grid_longitude: number;
  average_relative_noise: number;
  measurement_count: number;
  contributing_users: number;
  hour_bucket: string;
  is_demo: true;
};

type DemoCellSeed = Omit<DemoNoiseCell, 'hour_bucket' | 'is_demo'>;

// Synthetic UW–Madison readings used only when no recent aggregate data exists.
// Coordinates are coarse grid centers and do not represent real measurements.
const DEMO_CELL_SEEDS: DemoCellSeed[] = [
  { grid_cell_id: '107691:-223501', grid_latitude: 43.0766, grid_longitude: -89.4002, average_relative_noise: 0.78, measurement_count: 18, contributing_users: 5 },
  { grid_cell_id: '107688:-223494', grid_latitude: 43.0754, grid_longitude: -89.3974, average_relative_noise: 0.66, measurement_count: 15, contributing_users: 4 },
  { grid_cell_id: '107688:-223510', grid_latitude: 43.0754, grid_longitude: -89.4038, average_relative_noise: 0.24, measurement_count: 12, contributing_users: 4 },
  { grid_cell_id: '107684:-223520', grid_latitude: 43.0738, grid_longitude: -89.4078, average_relative_noise: 0.39, measurement_count: 9, contributing_users: 3 },
  { grid_cell_id: '107681:-223529', grid_latitude: 43.0726, grid_longitude: -89.4114, average_relative_noise: 0.58, measurement_count: 14, contributing_users: 5 },
  { grid_cell_id: '107678:-223518', grid_latitude: 43.0714, grid_longitude: -89.407, average_relative_noise: 0.71, measurement_count: 21, contributing_users: 6 },
  { grid_cell_id: '107696:-223514', grid_latitude: 43.0786, grid_longitude: -89.4054, average_relative_noise: 0.18, measurement_count: 10, contributing_users: 3 },
  { grid_cell_id: '107700:-223535', grid_latitude: 43.0802, grid_longitude: -89.4138, average_relative_noise: 0.12, measurement_count: 8, contributing_users: 3 },
  { grid_cell_id: '107686:-223485', grid_latitude: 43.0746, grid_longitude: -89.3938, average_relative_noise: 0.9, measurement_count: 25, contributing_users: 7 },
  { grid_cell_id: '107679:-223496', grid_latitude: 43.0718, grid_longitude: -89.3982, average_relative_noise: 0.46, measurement_count: 11, contributing_users: 4 },
  { grid_cell_id: '107674:-223532', grid_latitude: 43.0698, grid_longitude: -89.4126, average_relative_noise: 0.84, measurement_count: 19, contributing_users: 5 },
  { grid_cell_id: '107693:-223528', grid_latitude: 43.0774, grid_longitude: -89.411, average_relative_noise: 0.31, measurement_count: 13, contributing_users: 4 },
];

export function createDemoNoiseCells(now = new Date()): DemoNoiseCell[] {
  const hour = new Date(now);
  hour.setMinutes(0, 0, 0);
  const hourBucket = hour.toISOString();

  return DEMO_CELL_SEEDS.map(cell => ({
    ...cell,
    hour_bucket: hourBucket,
    is_demo: true,
  }));
}
