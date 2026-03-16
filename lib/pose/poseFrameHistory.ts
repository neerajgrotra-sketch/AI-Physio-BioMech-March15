import type { MovementFeatures } from "@/lib/types/movement";

export class FeatureHistory {
  private maxLength: number;
  private items: MovementFeatures[];

  constructor(maxLength = 5) {
    this.maxLength = maxLength;
    this.items = [];
  }

  push(features: MovementFeatures) {
    this.items.push(features);

    if (this.items.length > this.maxLength) {
      this.items.shift();
    }
  }

  clear() {
    this.items = [];
  }

  getAll(): MovementFeatures[] {
    return [...this.items];
  }

  getLatest(): MovementFeatures | null {
    return this.items.length > 0 ? this.items[this.items.length - 1] : null;
  }

  size(): number {
    return this.items.length;
  }
}
