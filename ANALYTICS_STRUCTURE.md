# Optimized Firestore Structure for Analytics

## Current Issues
- Session IDs like `quiz_user@email.com_1757768436021` are hard to query by date
- Limited user history (only last 10 quizzes)
- No date-based partitioning for efficient queries
- Missing analytics-friendly fields

## Recommended Structure

### 1. Quiz Sessions Collection
**Document ID**: `YYYY-MM-DD_HH-MM-SS_sanitizedUserId_hash`
```
quiz_sessions/
  ├── 2024-01-15_14-30-25_user_email_com_a1b2c3/
  │   ├── userId: "user@email.com"
  │   ├── startTime: Timestamp
  │   ├── endTime: Timestamp
  │   ├── score: 42
  │   ├── totalQuestions: 50
  │   ├── percentage: 84
  │   ├── duration: 480 (seconds)
  │   ├── completed: true
  │   ├── questions: [...]
  │   ├── answers: [...]
  │   └── date: "2024-01-15" (for easy querying)
  └── 2024-01-15_15-45-12_user_email_com_d4e5f6/
```

### 2. User Summary Collection
**Document ID**: `userId`
```
users/
    ├── user@email.com/
    │   ├── userId: "user@email.com"
    │   ├── totalQuizzes: 25
    │   ├── totalScore: 1050
    │   ├── averageScore: 42
    │   ├── bestScore: 48
    │   ├── firstQuizDate: Timestamp
    │   └── lastQuizDate: Timestamp
```

### 2b. User Quiz Attempts Collection (ALL attempts)
**Document ID**: `sessionId` (same as quiz_sessions)
```
user_quiz_attempts/
  ├── 2024-01-15_14-30-25_user_email_com_a1b2c3/
  │   ├── sessionId: "2024-01-15_14-30-25_user_email_com_a1b2c3"
  │   ├── score: 42
  │   ├── totalQuestions: 50
  │   ├── percentage: 84
  │   ├── completedAt: Timestamp
  │   ├── answers: [...]
  │   └── createdAt: Timestamp
  └── 2024-01-15_15-45-12_user_email_com_d4e5f6/
```

### 3. Daily Analytics Collection
**Document ID**: `YYYY-MM-DD`
```
daily_analytics/
  ├── 2024-01-15/
  │   ├── date: "2024-01-15"
  │   ├── totalUsers: 45
  │   ├── totalQuizzes: 67
  │   ├── averageScore: 41.2
  │   ├── totalTimeSpent: 32100
  │   ├── topWords: ["cat", "dog", "run"]
  │   └── userStats: {...}
  └── 2024-01-16/
```

### 4. Word Analytics Collection
**Document ID**: `word`
```
word_analytics/
  ├── cat/
  │   ├── word: "cat"
  │   ├── timesTested: 150
  │   ├── timesCorrect: 120
  │   ├── accuracy: 80
  │   ├── lastUsed: Timestamp
  │   ├── difficulty: "easy" (based on accuracy)
  │   └── recentTests: [...]
  └── sophisticated/
```

## Benefits of This Structure

### For User Dashboard:
- ✅ Easy to query user's recent performance
- ✅ Calculate streaks and progress
- ✅ Show detailed quiz history
- ✅ Performance trends over time

### For Admin Dashboard:
- ✅ Daily/weekly/monthly analytics
- ✅ User engagement metrics
- ✅ Word difficulty analysis
- ✅ Performance trends
- ✅ Most/least tested words

### Query Examples:

```javascript
// Get user's last 30 days performance
db.collection('quiz_sessions')
  .where('userId', '==', 'user@email.com')
  .where('date', '>=', '2024-01-01')
  .orderBy('date', 'desc')

// Get today's analytics
db.collection('daily_analytics')
  .doc('2024-01-15')
  .get()

// Get most tested words this week
db.collection('word_analytics')
  .orderBy('timesTested', 'desc')
  .limit(20)

// Get recent quiz activity
db.collection('quiz_sessions')
  .where('date', '>=', '2024-01-10')
  .orderBy('startTime', 'desc')
  .limit(50)
```

## Migration Strategy

1. **Keep current structure** for backward compatibility
2. **Add new fields** to existing documents
3. **Create new collections** for analytics
4. **Gradually migrate** data as needed
5. **Update APIs** to write to both structures

## Implementation Priority

1. **High Priority**: User dashboard (review past scores)
2. **Medium Priority**: Admin analytics dashboard
3. **Low Priority**: Advanced analytics and reporting
