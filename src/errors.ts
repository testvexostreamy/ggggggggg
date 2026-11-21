export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

export class BadInputError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Invalid or missing API key") {
    super(401, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
  }
}

export class RateLimitError extends HttpError {
  readonly retryAfter: number;

  constructor(retryAfter: number, message = "Rate limit exceeded") {
    super(429, message);
    this.retryAfter = retryAfter;
  }
}

export class UpstreamError extends HttpError {
  constructor(message = "Upstream YouTube request failed") {
    super(502, message);
  }
}

export class TimeoutError extends HttpError {
  constructor(message = "Upstream YouTube request timed out") {
    super(504, message);
  }
}
