export const findingStatuses = ['pending', 'in_progress', 'confirmed', 'resolved', 'fixed', 'false_positive', 'ignored', 'duplicate', 'risk_accepted'];
export class FindingsError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'FindingsError';
    }
}
