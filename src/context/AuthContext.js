import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'worker'
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const auth = getAuth();
    const db = getFirestore();
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        // --- FETCH ROLE ---
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists() && userDoc.data().role) {
            setRole(userDoc.data().role);
          } else {
            setRole('worker'); // Fallback default
          }
        } catch (error) {
          console.error("Failed to fetch user role:", error);
          setRole('worker'); // Safe fallback
        }
        
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);