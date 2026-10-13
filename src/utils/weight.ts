import type { WeightUnit } from '@/types/domain';

const KG_PER_LB = 0.45359237;

export function displayWeight(kg: number, unit: WeightUnit): number {
  return roundWeight(unit === 'lb' ? kg / KG_PER_LB : kg);
}

export function inputWeightToKg(value: number, unit: WeightUnit): number {
  return roundWeight(unit === 'lb' ? value * KG_PER_LB : value);
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${displayWeight(kg, unit)} ${unit}`;
}

function roundWeight(value: number): number {
  return Math.round(value * 10) / 10;
}
