import '../styles/home-gradient-button.css';

export function GradientButton({ as: Tag = 'button', children, ...props }) {
  return (
    <Tag className="gradient-btn" {...props}>
      <strong className="gradient-btn__text">{children}</strong>
      <div className="gradient-btn__stars-container">
        <div className="gradient-btn__stars" />
      </div>
      <div className="gradient-btn__glow">
        <div className="gradient-btn__circle" />
        <div className="gradient-btn__circle" />
      </div>
    </Tag>
  );
}
