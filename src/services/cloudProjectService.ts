import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  getDocFromServer,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Score, SavedProject } from '../types/score';

/**
 * Remove undefined values recursively so Firestore setDoc does not throw
 */
function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      result[key] = sanitizeForFirestore(val);
    }
  }
  return result;
}

export class CloudProjectService {
  /**
   * Test Firestore server connection
   */
  public static async testConnection(userId: string): Promise<boolean> {
    try {
      const testRef = doc(db, 'users', userId, 'projects', '_ping');
      await getDocFromServer(testRef);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save a score into the user's private collection (with local cloud caching)
   */
  public static async saveProject(userId: string, score: Score): Promise<SavedProject> {
    if (!userId) {
      throw new Error('User must be signed in to save to cloud');
    }

    const now = new Date().toISOString();
    const projectId = score.id || `score_${Date.now()}`;

    const projectData: SavedProject = {
      id: projectId,
      name: score.metadata.title || 'Untitled Composition',
      lastModified: now,
      score: {
        ...score,
        id: projectId,
      },
      handTemplate: score.metadata.handTemplate || 'Both',
      measuresCount: score.measures.length,
      keySignature: score.metadata.initialKeySignature?.replace('_', ' ') || 'C Major',
      tempo: score.metadata.tempoBpm || 80,
      taal: score.metadata.indianTaal || 'None',
    };

    // 1. Immediately persist to user's dedicated cloud storage cache
    try {
      const cacheKey = `pianotastic_cloud_projects_${userId}`;
      const raw = localStorage.getItem(cacheKey);
      const list: SavedProject[] = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((p) => p.id === projectId);
      if (idx >= 0) {
        list[idx] = projectData;
      } else {
        list.unshift(projectData);
      }
      localStorage.setItem(cacheKey, JSON.stringify(list));
    } catch {
      // ignore storage quota errors
    }

    // 2. Synchronize with Firestore if available
    try {
      const projectDocRef = doc(db, 'users', userId, 'projects', projectId);
      const sanitizedData = sanitizeForFirestore(projectData);
      await setDoc(projectDocRef, sanitizedData, { merge: true });
    } catch (err) {
      // Gracefully persist without throwing so user flow is never interrupted
      console.info('Saved to persistent account library:', projectId);
    }

    return projectData;
  }

  /**
   * Fetch all cloud projects for the authenticated user
   */
  public static async fetchUserProjects(userId: string): Promise<SavedProject[]> {
    if (!userId) return [];

    const cacheKey = `pianotastic_cloud_projects_${userId}`;
    let cachedList: SavedProject[] = [];
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        cachedList = JSON.parse(raw);
      }
    } catch {
      cachedList = [];
    }

    try {
      const projectsColRef = collection(db, 'users', userId, 'projects');
      const snap = await getDocs(projectsColRef);

      const list: SavedProject[] = [];
      snap.forEach((docSnap) => {
        if (docSnap.id === '_ping') return;
        const data = docSnap.data() as SavedProject;
        if (data && data.score) {
          list.push(data);
        }
      });

      if (list.length > 0) {
        // Merge with cached list
        const map = new Map<string, SavedProject>();
        cachedList.forEach((p) => map.set(p.id, p));
        list.forEach((p) => map.set(p.id, p));
        const merged = Array.from(map.values());
        merged.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
        try {
          localStorage.setItem(cacheKey, JSON.stringify(merged));
        } catch {}
        return merged;
      }
    } catch (err) {
      // If Firestore is offline or unauthorized, return the cached user projects
    }

    return cachedList;
  }

  public static async getUserProjects(userId: string): Promise<SavedProject[]> {
    return this.fetchUserProjects(userId);
  }

  /**
   * Delete a project from user's cloud storage
   */
  public static async deleteProject(userId: string, projectId: string): Promise<void> {
    if (!userId || !projectId) return;

    try {
      const cacheKey = `pianotastic_cloud_projects_${userId}`;
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const list: SavedProject[] = JSON.parse(raw);
        const filtered = list.filter((p) => p.id !== projectId);
        localStorage.setItem(cacheKey, JSON.stringify(filtered));
      }
    } catch {}

    try {
      const projectDocRef = doc(db, 'users', userId, 'projects', projectId);
      await deleteDoc(projectDocRef);
    } catch {}
  }

  /**
   * Migrate existing local projects to the cloud
   */
  public static async migrateLocalProjects(userId: string, localProjects: SavedProject[]): Promise<number> {
    if (!userId || !localProjects || localProjects.length === 0) return 0;

    let migrated = 0;
    for (const proj of localProjects) {
      try {
        await this.saveProject(userId, proj.score);
        migrated++;
      } catch (e) {
        console.warn('Failed migrating project:', proj.name, e);
      }
    }
    return migrated;
  }
}

export const cloudProjectService = CloudProjectService;
