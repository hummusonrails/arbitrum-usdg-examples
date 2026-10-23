export function Lamp({
    on,
    alert = false,
    delay = 0,
}: {
    on: boolean;
    alert?: boolean;
    delay?: number;
}) {
    return (
        <span
            className="lamp"
            data-on={on && !alert}
            data-alert={alert}
            style={{ ['--lamp-delay' as string]: `${delay}ms` }}
            aria-hidden
        />
    );
}
