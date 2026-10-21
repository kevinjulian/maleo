/* The shortest password the deployment accepts. One constant, read by the auth
 * config that enforces it and by every form that states it, so a form cannot
 * promise a minimum the server does not hold. */
export const PASSWORD_MIN_LENGTH = 12;
