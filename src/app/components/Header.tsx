'use client';

import Link from "next/link";

interface User {
  email: string;
  name?: string;
}

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
}

export function Header({ user, onLogout }: HeaderProps) {
  return (
    <header className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">L</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">LexiLeap</h1>
          </Link>
          
          {user && (
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-600">
                Welcome, <span className="font-medium">{user.name || user.email}</span>
              </div>
              <button
                onClick={onLogout}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


