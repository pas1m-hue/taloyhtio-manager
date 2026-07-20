export interface ServerClock {
  now(): string;
}

export class SystemServerClock implements ServerClock {
  public now(): string {
    return new Date().toISOString();
  }
}

export class FixedServerClock implements ServerClock {
  readonly #value: string;

  public constructor(value: string) {
    const date = new Date(value);
    if (value.trim() === "" || !Number.isFinite(date.getTime())) {
      throw new Error(`Fixed server clock value ${value} is invalid.`);
    }
    this.#value = date.toISOString();
  }

  public now(): string {
    return this.#value;
  }
}
