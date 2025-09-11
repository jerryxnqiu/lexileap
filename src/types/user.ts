export interface User {
  email: string;
  name?: string;
  createdAt?: Date;
  lastLoginAt?: Date;
  isAdmin?: boolean;
}
