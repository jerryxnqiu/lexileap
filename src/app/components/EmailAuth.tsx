'use client';

import { useState, useRef, useEffect } from 'react';

interface EmailAuthProps {
  onLogin: (email: string, name?: string, isAdmin?: boolean) => void;
}

export function EmailAuth({ onLogin }: EmailAuthProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(Array(6).fill(''));
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [message, setMessage] = useState('');

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    
    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to send verification code');
        return;
      }
      
      setMessage('Verification code sent to your email!');
      setStep('code');
      setCodeDigits(Array(6).fill(''));
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const combined = codeDigits.join('');
    if (!combined.trim()) {
      setError('Please enter the verification code');
      return;
    }
    if (combined.length !== 6) {
      setError('Please enter the 6-digit verification code');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email: email.trim(), 
          code: combined 
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to verify code');
        return;
      }
      
      // Login successful
      onLogin(email.trim(), name.trim() || undefined, data?.user?.isAdmin);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setCodeDigits(Array(6).fill(''));
    setError('');
    setMessage('');
  };

  // Focus first input when entering code step
  useEffect(() => {
    if (step === 'code') {
      inputsRef.current[0]?.focus();
    }
  }, [step]);

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(0, 1);
    const next = [...codeDigits];
    next[index] = digit;
    setCodeDigits(next);
    if (digit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (codeDigits[index]) {
        const next = [...codeDigits];
        next[index] = '';
        setCodeDigits(next);
      } else if (index > 0) {
        inputsRef.current[index - 1]?.focus();
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = Array(6).fill('');
    for (let i = 0; i < text.length && i < 6; i++) next[i] = text[i]!;
    setCodeDigits(next);
    const focusIndex = Math.min(text.length, 5);
    inputsRef.current[focusIndex]?.focus();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
        {step === 'email' ? 'Get Started' : 'Verify Your Email'}
      </h2>
      
      {step === 'email' ? (
        <form onSubmit={handleSendCode} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email Address *
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
            placeholder="your@email.com"
            disabled={isLoading}
            required
          />
        </div>
        
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name (Optional)
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
            placeholder="Your name"
            disabled={isLoading}
          />
        </div>
        
          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
              {error}
            </div>
          )}
          
          {message && (
            <div className="text-green-600 text-sm bg-green-50 p-3 rounded-md">
              {message}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Sending Code...
              </div>
            ) : (
              'Send Verification Code'
            )}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div className="text-center mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-green-600 text-xl">📧</span>
            </div>
            <p className="text-gray-600">
              We&#39;ve sent a 6-digit verification code to:
            </p>
            <p className="font-medium text-gray-900">{email}</p>
            <p className="text-xs text-gray-500 mt-1">
              Check your inbox and spam folder
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Verification Code
            </label>
            <div className="flex items-center justify-between gap-2">
              {codeDigits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputsRef.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={d}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  className="w-12 h-12 text-center text-xl text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  maxLength={1}
                  required
                />
              ))}
            </div>
          </div>
          
          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Verifying...
              </div>
            ) : (
              'Verify Code'
            )}
          </button>
          
          <button
            type="button"
            onClick={handleBackToEmail}
            className="w-full text-gray-600 py-2 px-4 rounded-md hover:text-gray-800 focus:outline-none transition-colors cursor-pointer"
          >
            Back to Email
          </button>
        </form>
      )}
    </div>
  );
}
