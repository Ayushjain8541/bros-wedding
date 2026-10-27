import { LoginForm } from "@/features/organizer/AdminSession";
import styles from "@/features/organizer/Admin.module.css";
export default function LoginPage() {
  return (
    <section className={styles.login}>
      <p>Private organizer desk</p>
      <h1>Welcome back</h1>
      <p>Sign in with the organizer account provided to you.</p>
      <LoginForm />
    </section>
  );
}
