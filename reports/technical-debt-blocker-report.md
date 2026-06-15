# Technical Debt & Blocker Report

**Project Status:** 78% Complete (Stabilization Phase)  
**Ecosystem:** Sahib (صاحب) - Internal Team Management & Operations Hub  

## The Top 3 Critical Blockers

### 1. Admin vs. Worker Authentication & Role Separation
**The Blocker:** Currently, there is no strict Role-Based Access Control (RBAC) enforced in the context state. Without robust role separation, workers could potentially access admin-level operations or chat features intended solely for oversight, leading to severe security and operational risks. 
**Impact:** High security risk. Prevents safe deployment of the app.

### 2. Operations Injector Dynamic Data Schema
**The Blocker:** The AI needs a reliable, flexible way to "inject" tools dynamically, but the database schema lacks a structured format to handle variable tool schemas, inputs, and execution endpoints. 
**Impact:** Prevents the core "Operations Injector" feature from functioning dynamically, hardcoding workflows instead.
**Proposed NoSQL Schema (Firebase-style):**
```json
// Collection: "operations"
{
  "operationId": "string",
  "name": "string",
  "description": "string",
  "accessLevel": "admin | worker", // Enforces RBAC at the tool level
  "schema": {
    "type": "object",
    "properties": {
      "param1": { "type": "string", "description": "..." }
    },
    "required": ["param1"]
  },
  "executionEndpoint": "string (URL or Cloud Function name)",
  "isActive": "boolean",
  "createdAt": "timestamp"
}
```

### 3. RTL Layout Integrity in CSS/Tailwind
**The Blocker:** The Sahib system is designed with strict Right-to-Left (RTL) layout integrity for Iraqi Arabic support. Standard Tailwind configurations without explicit RTL support can break layouts when toggling between LTR fallbacks or rendering specific Arabic typography components.
**Impact:** Severe UI/UX degradation for the target Arabic-native audience.


---

## Action Plan for Blocker #1 (Auth & Role Separation)

**File to modify:** `src/context/AuthContext.js` (or your primary auth context file)

**The Fix:** We need to fetch the user's role directly from the database upon authentication and expose it globally through the context, defaulting to `"worker"` for safety.

**Exact Modular Code Patch:**
Add the role-fetching logic inside your existing `onAuthStateChanged` listener. Do not alter your provider's surrounding structure.

```javascript
import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore'; // ADDED FIRESTORE IMPORTS

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // ADDED ROLE STATE
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const auth = getAuth();
    const db = getFirestore(); // INITIALIZE DB
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        // --- NEW MODULAR PATCH: FETCH ROLE ---
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists() && userDoc.data().role) {
            setRole(userDoc.data().role); // Set to 'admin' or 'worker'
          } else {
            setRole('worker'); // Fallback default role
          }
        } catch (error) {
          console.error("Failed to fetch user role:", error);
          setRole('worker'); // Safe fallback on error
        }
        // --------------------------------------
        
      } else {
        setUser(null);
        setRole(null); // RESET ROLE ON LOGOUT
      }
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  return (
    // EXPOSE ROLE TO THE CONTEXT PROVIDER
    <AuthContext.Provider value={{ user, role, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
```

**Next Step:** Once you implement this patch in `src/context/AuthContext.js`, your app will safely distinguish between `role === 'admin'` and `role === 'worker'`. You can then use `const { role } = useAuth();` in your routing or UI components to conditionally render the Operations Injector only for admins.