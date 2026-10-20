import { useEffect, useState } from "react";
import { host, type HostMessage } from "../host";
import css from "../css/tree_app.module.css";

// Options for the category dropdown; the chosen value is prefixed to the
// GitHub issue title by the extension host.
const FEEDBACK_CATEGORIES = ["Bug", "Feature request", "Question", "Other"];

/** Green (success) or red (error) banner rendered above the submit button. */
interface INotice {
    kind: "success" | "error";
    message: string;
    /** Link to the created issue, present only on success. */
    issueUrl?: string;
}

/**
 * Feedback / bug-report panel shown inside the tree app when the user clicks
 * the "Raise an issue / Give feedback" footer row.
 *
 * Renders a form (subject, category, description, optional email) and sends
 * it to the extension host as a `post_github_issue` instruction. The host
 * creates a GitHub issue with the user's own GitHub OAuth session and posts
 * a `github_issue_result` message back, which this component turns into a
 * green success notice (with a link to the issue) or a red failure notice.
 *
 * @param onClose - Called when the user clicks the X in the panel header;
 *   the parent uses it to switch back to the main steps panel.
 * @returns The feedback panel element.
 */
export default function FeedbackUi({ onClose }: { onClose: () => void }) {
    const [subject, setSubject] = useState("");
    const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0]);
    const [description, setDescription] = useState("");
    const [email, setEmail] = useState("");
    const [notice, setNotice] = useState<INotice | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Listen for the submission outcome broadcast back by the extension host.
    useEffect(() => {
        const handler = (message: HostMessage) => {
            if (message?.type !== "github_issue_result") {
                return;
            }
            setIsSubmitting(false);
            if (message.ok) {
                // Defense in depth: the URL comes from the GitHub API response,
                // but only ever render an anchor for a real github.com link.
                const issueUrl = typeof message.issueUrl === "string" && message.issueUrl.startsWith("https://github.com/")
                    ? message.issueUrl
                    : undefined;
                setNotice({
                    kind: "success",
                    message: "Your issue was submitted successfully. Thank you!",
                    issueUrl,
                });
                // Clear the form so a second submission starts fresh.
                setSubject("");
                setDescription("");
                setEmail("");
            } else {
                setNotice({
                    kind: "error",
                    message: `Failed to submit: ${message.error || "unknown error"}`,
                });
            }
        };
        return host.onMessage(handler);
    }, []);

    /**
     * Sends the form content to the extension host, which posts the GitHub
     * issue. Disables the submit button until the result message comes back.
     *
     * @param event - Form submit event; default navigation is prevented.
     */
    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isSubmitting) {
            return;
        }
        setNotice(null);
        setIsSubmitting(true);
        host.postMessage({
            frontendInstruction: "post_github_issue",
            fromPanel: "treeView",
            subject,
            category,
            description,
            email,
        });
    };

    return (
        <div className={css.feedback_panel_container}>
            <div className={css.feedback_panel_header}>
                <span className={css.feedback_panel_title}>Report a bug / Feedback</span>
                <button
                    type="button"
                    className={css.feedback_close_btn}
                    onClick={onClose}
                    title="Close and return to steps"
                    aria-label="Close feedback panel"
                >
                    ✕
                </button>
            </div>

            <form className={css.feedback_form} onSubmit={handleSubmit}>
                <label className={css.feedback_field_label}>
                    Subject
                    <input
                        type="text"
                        className={css.feedback_input}
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Short summary of the issue"
                        maxLength={200}
                        required
                    />
                </label>

                <label className={css.feedback_field_label}>
                    Category
                    <select
                        className={css.feedback_select}
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                    >
                        {FEEDBACK_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </label>

                <label className={css.feedback_field_label}>
                    Description
                    <textarea
                        className={css.feedback_textarea}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What happened? What did you expect?"
                        rows={6}
                        maxLength={60000}
                        required
                    />
                </label>

                <label className={css.feedback_field_label}>
                    Your email (optional)
                    <input
                        type="email"
                        className={css.feedback_input}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="So we can follow up with you"
                        maxLength={200}
                    />
                </label>

                {notice && (
                    <div className={notice.kind === "success" ? css.feedback_notice_success : css.feedback_notice_error}>
                        <span>{notice.message}</span>
                        {notice.issueUrl && (
                            <a className={css.feedback_notice_link} href={notice.issueUrl}>
                                View the issue on GitHub ↗
                            </a>
                        )}
                    </div>
                )}

                <p className={css.feedback_privacy_note}>
                    This issue will be visible in the public GitHub repository. <br />
                    Alternatively, you can email us at{" "}
                    <a className={css.feedback_notice_link} href="mailto:flowsheetinspector@lbl.gov">
                        flowsheetinspector@lbl.gov
                    </a>{" "}
                    instead.
                </p>

                <button
                    type="submit"
                    className={css.feedback_submit_btn}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? "Submitting..." : "Submit"}
                </button>
            </form>
        </div>
    );
}
