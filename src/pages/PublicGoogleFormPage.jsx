import Brand from '../components/Brand.jsx'

const googleFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfJ5NDal89SNvzA7UkR9_0q9ZBjsd2fxRYZkoLhC7L6IhMTsg/viewform?usp=header'
const embeddedGoogleFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfJ5NDal89SNvzA7UkR9_0q9ZBjsd2fxRYZkoLhC7L6IhMTsg/viewform?embedded=true'

export default function PublicGoogleFormPage() {
  return <main className="google-form-page">
    <header className="google-form-header"><Brand /><p>Preencha seus dados para concluir o cadastro. <a href={googleFormUrl} target="_blank" rel="noreferrer">Abrir formulário em nova aba</a></p></header>
    <iframe title="Formulário de cadastro de cliente" src={embeddedGoogleFormUrl} className="google-form-frame" loading="lazy" />
    <p className="google-form-follow-up">Use o mesmo e-mail da sua conta Print Caju. Após enviar, volte para a <a href="/conta">área do cliente</a> quando seu cadastro for sincronizado.</p>
  </main>
}
