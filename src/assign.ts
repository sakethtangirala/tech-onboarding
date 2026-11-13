import { collections, type Assignment } from "./db.js";
import { ObjectId } from "mongodb";

export type AssignResult =
  | { kind: "assigned"; assignment: Assignment }
  | { kind: "judge-busy" } // the judge already holds a QUEUED assignment
  | { kind: "none-available" }; // no project is eligible for this judge right now

/**
 * assigns the next project to the judge, if possible
 * @param judgeId 
 * @returns an object indicating the result of the assignment attempt
 */
export async function assignNext(judgeId: string): Promise<AssignResult> {

  //check if the judge is busy or if there are no projects available
  const checkResult = await checks(judgeId);
  if (checkResult) {
    return checkResult;
  }

  //if multiple projects are available, pick least completed (breaking ties randomly) and assign
  if((await collections().projects.countDocuments()) > 1) {
    const availableProjects = await collections().projects.find({}).toArray();
    const completedAssignments = await collections().assignments.find({ status: "COMPLETED" }).toArray();
    const projectCompletedMap = await completedMap(completedAssignments);
    let selectedProject = pickLeastCompletedProject(availableProjects, projectCompletedMap);
    return makeAssignment(judgeId, selectedProject._id.toString());
  } 
  
  //if only one project is available, assign it to the judge
  const onlyProject = await collections().projects.findOne({});
  if (onlyProject) {
    return makeAssignment(judgeId, onlyProject._id.toString());
  }

  //if the only project is null, then none are available
  return { kind: "none-available" };

}

/**
 * checks if the judge is busy or if there are no projects available
 * @param judgeId 
 * @returns the result of the check, either judge-busy or none-available, or null if both checks pass
 */
export async function checks(judgeId: string): Promise<any> {
  if (await collections().assignments.findOne({ judgeId, status: "QUEUED" })) {
    return { kind: "judge-busy" };
  }
  if ((await collections().projects.countDocuments()) === 0) {
    return { kind: "none-available" };
  }
  return null;
}

/**
 * picks the project with the least number of completed assignments, breaking ties randomly.
 * @param availableProjects 
 * @param projectCompletedMap 
 * @returns the project with the least number of completed assignments after checking and randomly breaking ties
 */
export function pickLeastCompletedProject(availableProjects: any[], projectCompletedMap: Map<string, number>): any {
    availableProjects.sort((a, b) => (projectCompletedMap.get(a._id.toString()) || 0) - (projectCompletedMap.get(b._id.toString()) || 0));
    let selectedProject = availableProjects[0]; 
    const minCompleted = projectCompletedMap.get(selectedProject._id.toString()) || 0;
    const tiedProjects = availableProjects.filter(p => (projectCompletedMap.get(p._id.toString()) || 0) === minCompleted);
    const randomIndex = Math.floor(Math.random() * tiedProjects.length);
    const finalSelectedProject = tiedProjects[randomIndex];
    return finalSelectedProject;
}

/**
 * Creates a map of project IDs to the number of completed assignments for each project.
 * @param completedAssignments 
 * @returns projectCompletedMap - a map of project IDs to the number of completed assignments for each project
 */
export async function completedMap(completedAssignments: Assignment[]): Promise<Map<string, number>> {
  const projectCompletedMap = new Map<string, number>();
  for (const assignment of completedAssignments) {
    projectCompletedMap.set(assignment.projectId, (projectCompletedMap.get(assignment.projectId) || 0) + 1);
  }
  return projectCompletedMap;
}

/**
 * creates a new assignment and adds to database. Returns the new assignment.
 * @param judgeId 
 * @param project
 * @returns pair with kind: "assigned" and the new assignment
 */
export async function makeAssignment(judgeId: string, projectId: string): Promise<{kind: "assigned"; assignment: Assignment}> {
  const newAssignment: Assignment = {
    _id: new ObjectId(),
    judgeId,  
    projectId,
    status: "QUEUED",
    createdAt: new Date(),
  };
  await collections().assignments.insertOne(newAssignment);
  return { kind: "assigned", assignment: newAssignment };
}
