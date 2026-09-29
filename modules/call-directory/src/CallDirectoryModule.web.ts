import inertCallDirectory from './inert';

/**
 * The web has no Call Directory to talk to, so there is no native module to
 * load: every call answers inertly through `inertCallDirectory`.
 */
export default inertCallDirectory;
